import { VectorTile } from '@mapbox/vector-tile';
import { File, Paths } from 'expo-file-system';
import { PbfReader } from 'pbf';
import { PMTiles, type RangeResponse } from 'pmtiles';

import { getDatabase } from '../../persistence/sqlite/Database';
import { runInTransaction } from '../../persistence/sqlite/Transactions';

const OUTPUT_PATH = 'files/maps/android-test-area.pmtiles';
const POI_TABLE = 'offline_poi';
const INDEX_ZOOM_MINIMUM = 5;
const INDEX_BATCH_SIZE = 500;

export const POI_ORIGIN = { latitude: 38.9897, longitude: -76.9426 } as const;

export interface PoiCategory {
  readonly key: string;
  readonly label: string;
}

export interface IndexedPoi {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly latitude: number;
  readonly longitude: number;
}

export interface IndexPoisResult {
  readonly count: number;
  readonly elapsedMs: number;
}

export interface SearchPoisOptions {
  readonly query: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusMeters: number;
  readonly limit: number;
}

export interface PoiSearchResult extends IndexedPoi {
  readonly distanceMeters: number;
}

export const POI_CATEGORIES: ReadonlyArray<PoiCategory> = [
  { key: 'hospital', label: 'Hospital' },
  { key: 'pharmacy', label: 'Pharmacy' },
  { key: 'food', label: 'Food' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'lodging', label: 'Hotel / lodging' },
  { key: 'shelter', label: 'Shelter' },
  { key: 'campsite', label: 'Campsite' },
];

interface RawPoi {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly kind: string;
  readonly latitude: number;
  readonly longitude: number;
}

interface GeoJsonPoint {
  readonly type: 'Point';
  readonly coordinates: readonly [number, number];
}

interface GeoJsonGeometry {
  readonly type: string;
  readonly coordinates: unknown;
}

interface PoiFileSource {
  readonly file: File;
  readonly bytes: ArrayBuffer;
}

function createPoiTable(): void {
  getDatabase().execSync(`
    CREATE TABLE IF NOT EXISTS ${POI_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL
    )
  `);
  getDatabase().execSync(`CREATE INDEX IF NOT EXISTS ix_offline_poi_category ON ${POI_TABLE}(category)`);
  getDatabase().execSync(`CREATE INDEX IF NOT EXISTS ix_offline_poi_name ON ${POI_TABLE}(name)`);
}

function expectedPoiFile(): File {
  return new File(Paths.document, OUTPUT_PATH);
}

function ensureExpectedPoiFile(pmtilesPath: string): File {
  const expected = expectedPoiFile();
  if (pmtilesPath !== expected.uri) {
    throw new Error('Offline POI indexing only accepts android-test-area.pmtiles.');
  }
  if (!expected.exists || (expected.size ?? 0) === 0) {
    throw new Error('The extracted android-test-area.pmtiles archive is not available.');
  }
  return expected;
}

function sourceForFile(file: File, bytes: ArrayBuffer): PoiFileSource & { getBytes: (offset: number, length: number) => Promise<RangeResponse>; getKey: () => string } {
  return {
    file,
    bytes,
    getKey: () => file.uri,
    getBytes: async (offset: number, length: number): Promise<RangeResponse> => ({
      data: bytes.slice(offset, offset + length),
    }),
  };
}

function tileX(longitude: number, zoom: number): number {
  return Math.floor(((longitude + 180) / 360) * (1 << zoom));
}

function tileY(latitude: number, zoom: number): number {
  const radians = Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));
  return Math.floor((0.5 - radians / (2 * Math.PI)) * (1 << zoom));
}

function categoryForKind(kind: string): string {
  if (kind === 'hospital') return 'hospital';
  if (kind === 'pharmacy' || kind === 'chemist') return 'pharmacy';
  if (['restaurant', 'fast_food', 'cafe', 'pub', 'bakery', 'bar', 'biergarten', 'ice_cream'].includes(kind)) return 'food';
  if (kind === 'fuel' || kind === 'service_station') return 'fuel';
  if (['hotel', 'motel', 'chalet', 'bed'].includes(kind)) return 'lodging';
  if (kind === 'shelter') return 'shelter';
  if (kind === 'camp_site' || kind === 'camp_pitch') return 'campsite';
  return kind;
}

function propertyString(properties: Record<string, number | string | boolean>, key: string): string {
  const value = properties[key];
  return typeof value === 'string' ? value.trim() : '';
}

function coordinatePairs(value: unknown): Array<readonly [number, number]> {
  if (!Array.isArray(value)) return [];
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    return [[value[0], value[1]]];
  }
  return value.flatMap((child) => coordinatePairs(child));
}

function geometryCenter(geometry: GeoJsonGeometry): GeoJsonPoint | null {
  const pairs = coordinatePairs(geometry.coordinates);
  if (pairs.length === 0) return null;
  const [longitude, latitude] = pairs.reduce(
    ([sumLongitude, sumLatitude], [nextLongitude, nextLatitude]) => [sumLongitude + nextLongitude, sumLatitude + nextLatitude],
    [0, 0],
  );
  return { type: 'Point', coordinates: [longitude / pairs.length, latitude / pairs.length] };
}

function normalizeFeature(feature: ReturnType<VectorTile['layers'][string]['feature']>, x: number, y: number, zoom: number): RawPoi | null {
  const kind = propertyString(feature.properties, 'kind');
  if (kind === '') return null;
  const geometry = feature.toGeoJSON(x, y, zoom).geometry as GeoJsonGeometry;
  const center = geometry.type === 'Point' ? geometry as GeoJsonPoint : geometryCenter(geometry);
  if (center === null) return null;
  const name = propertyString(feature.properties, 'name') || propertyString(feature.properties, 'name:en') || kind.replaceAll('_', ' ');
  const sourceId = feature.id === undefined ? `${kind}:${name}:${center.coordinates[0].toFixed(6)}:${center.coordinates[1].toFixed(6)}` : `${kind}:${feature.id}`;
  return {
    id: sourceId,
    name,
    category: categoryForKind(kind),
    kind,
    latitude: center.coordinates[1],
    longitude: center.coordinates[0],
  };
}

function insertPois(pois: ReadonlyArray<RawPoi>): void {
  const database = getDatabase();
  runInTransaction(database, () => {
    for (const poi of pois) {
      database.runSync(
        `INSERT OR REPLACE INTO ${POI_TABLE}(id, name, category, source_kind, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)`,
        [poi.id, poi.name, poi.category, poi.kind, poi.latitude, poi.longitude],
      );
    }
  });
}

function haversineMeters(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number): number {
  const earthRadiusMeters = 6371000;
  const latitudeDelta = ((latitudeB - latitudeA) * Math.PI) / 180;
  const longitudeDelta = ((longitudeB - longitudeA) * Math.PI) / 180;
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos((latitudeA * Math.PI) / 180) * Math.cos((latitudeB * Math.PI) / 180) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function indexPoisFromPmtiles(pmtilesPath: string): Promise<IndexPoisResult> {
  const startedAt = Date.now();
  const file = ensureExpectedPoiFile(pmtilesPath);
  const bytes = await file.arrayBuffer();
  const archive = new PMTiles(sourceForFile(file, bytes));
  const header = await archive.getHeader();
  const seen = new Set<string>();
  const pois: RawPoi[] = [];

  for (let zoom = Math.max(INDEX_ZOOM_MINIMUM, header.minZoom); zoom <= header.maxZoom; zoom++) {
    for (let x = tileX(header.minLon, zoom); x <= tileX(header.maxLon, zoom); x++) {
      for (let y = tileY(header.maxLat, zoom); y <= tileY(header.minLat, zoom); y++) {
        const tile = await archive.getZxy(zoom, x, y);
        if (tile === undefined) continue;
        const layer = new VectorTile(new PbfReader(tile.data)).layers.pois;
        if (layer === undefined) continue;
        for (let featureIndex = 0; featureIndex < layer.length; featureIndex++) {
          const poi = normalizeFeature(layer.feature(featureIndex), x, y, zoom);
          if (poi === null || seen.has(poi.id)) continue;
          seen.add(poi.id);
          pois.push(poi);
        }
        await Promise.resolve();
      }
    }
  }

  createPoiTable();
  getDatabase().execSync(`DELETE FROM ${POI_TABLE}`);
  for (let index = 0; index < pois.length; index += INDEX_BATCH_SIZE) {
    insertPois(pois.slice(index, index + INDEX_BATCH_SIZE));
    await Promise.resolve();
  }
  return { count: pois.length, elapsedMs: Date.now() - startedAt };
}

export function getIndexedPoiCount(): number {
  createPoiTable();
  const row = getDatabase().getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${POI_TABLE}`);
  return row?.count ?? 0;
}

export function searchPois(options: SearchPoisOptions): Array<PoiSearchResult> {
  createPoiTable();
  const query = options.query.trim().toLowerCase();
  const rows = getDatabase().getAllSync<IndexedPoi>(
    `SELECT id, name, category, latitude, longitude FROM ${POI_TABLE}
     WHERE (? = '' OR lower(name) LIKE ? OR lower(category) = ? OR lower(source_kind) = ?)`
    , [query, `%${query}%`, query, query],
  );
  return rows
    .map((poi) => ({ ...poi, distanceMeters: haversineMeters(options.latitude, options.longitude, poi.latitude, poi.longitude) }))
    .filter((poi) => poi.distanceMeters <= options.radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, options.limit);
}
