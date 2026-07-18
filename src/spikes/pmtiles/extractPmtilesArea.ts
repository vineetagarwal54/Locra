import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { gunzipSync, gzipSync } from 'fflate';

export interface ExtractPmtilesAreaOptions {
  sourceUrl: string;
  outputPath: string;
  west: number;
  south: number;
  east: number;
  north: number;
  maxZoom: number;
  signal?: AbortSignal;
  onProgress?: (progress: ExtractPmtilesProgress) => void;
}

export interface ExtractPmtilesProgress {
  bytesTransferred: number;
  requestCount: number;
  outputBytes: number;
}

interface Entry { tileId: number; offset: number; length: number; runLength: number; }
interface Header { rootOffset: number; rootLength: number; metadataOffset: number; metadataLength: number; leafOffset: number; tileOffset: number; internalCompression: number; tileCompression: number; tileType: number; minZoom: number; maxZoom: number; minLon: number; minLat: number; maxLon: number; maxLat: number; }

const HEADER_SIZE = 127;

function uint64(view: DataView, offset: number): number {
  return view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 0x100000000;
}

function parseHeader(bytes: Uint8Array): Header {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (new TextDecoder().decode(bytes.slice(0, 6)) !== 'PMTile') throw new Error('Invalid PMTiles magic');
  return {
    rootOffset: uint64(view, 8), rootLength: uint64(view, 16), metadataOffset: uint64(view, 24), metadataLength: uint64(view, 32),
    leafOffset: uint64(view, 40), tileOffset: uint64(view, 56), internalCompression: view.getUint8(97), tileCompression: view.getUint8(98), tileType: view.getUint8(99),
    minZoom: view.getUint8(100), maxZoom: view.getUint8(101), minLon: view.getInt32(102, true) / 1e7, minLat: view.getInt32(106, true) / 1e7, maxLon: view.getInt32(110, true) / 1e7, maxLat: view.getInt32(114, true) / 1e7,
  };
}

function readVarint(bytes: Uint8Array, state: { position: number }): number {
  let value = 0; let shift = 0;
  for (;;) { const byte = bytes[state.position++]; value += (byte & 0x7f) * 2 ** shift; if (byte < 128) return value; shift += 7; }
}

function decodeDirectory(bytes: Uint8Array, compression: number): Entry[] {
  const data = compression === 2 ? gunzipSync(bytes) : bytes;
  const state = { position: 0 }; const count = readVarint(data, state); const entries: Entry[] = [];
  let tileId = 0;
  for (let i = 0; i < count; i++) { tileId += readVarint(data, state); entries.push({ tileId, offset: 0, length: 0, runLength: 0 }); }
  for (const entry of entries) entry.runLength = readVarint(data, state);
  for (const entry of entries) entry.length = readVarint(data, state);
  for (let i = 0; i < entries.length; i++) { const value = readVarint(data, state); entries[i].offset = value === 0 && i > 0 ? entries[i - 1].offset + entries[i - 1].length : value - 1; }
  return entries;
}

function rotate(n: number, x: number, y: number, rx: number, ry: number): [number, number] {
  if (ry === 0) return rx === 0 ? [y, x] : [n - 1 - y, n - 1 - x];
  return [x, y];
}

function zxyToTileId(z: number, x: number, y: number): number {
  let id = ((1 << z) * (1 << z) - 1) / 3; let tx = x; let ty = y;
  for (let size = 1 << (z - 1); size > 0; size >>= 1) { const rx = tx & size; const ry = ty & size; id += ((3 * rx) ^ ry) * size; [tx, ty] = rotate(size, tx, ty, rx, ry); }
  return id;
}

function lonToX(lon: number, z: number): number { return ((lon + 180) / 360) * (1 << z); }
function latToY(lat: number, z: number): number { const r = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)); return (0.5 - r / (2 * Math.PI)) * (1 << z); }

function encodeVarint(value: number): number[] { const bytes: number[] = []; do { const byte = value % 128; value = Math.floor(value / 128); bytes.push(byte | (value > 0 ? 128 : 0)); } while (value > 0); return bytes; }

function encodeEntries(entries: Entry[]): Uint8Array {
  const bytes: number[] = [...encodeVarint(entries.length)]; let previous = 0;
  for (const entry of entries) { bytes.push(...encodeVarint(entry.tileId - previous)); previous = entry.tileId; }
  for (const entry of entries) bytes.push(...encodeVarint(entry.runLength));
  for (const entry of entries) bytes.push(...encodeVarint(entry.length));
  previous = 0;
  for (let i = 0; i < entries.length; i++) { const entry = entries[i]; const value = i > 0 && entry.offset === entries[i - 1].offset + entries[i - 1].length ? 0 : entry.offset + 1; bytes.push(...encodeVarint(value)); }
  return new Uint8Array(bytes);
}

function writeUint64(view: DataView, offset: number, value: number): void { view.setUint32(offset, value >>> 0, true); view.setUint32(offset + 4, Math.floor(value / 0x100000000), true); }
function writeHeader(header: Header, rootLength: number, metadataOffset: number, tileOffset: number, tileLength: number, tileCount: number): Uint8Array {
  const bytes = new Uint8Array(HEADER_SIZE); const view = new DataView(bytes.buffer); new TextEncoder().encodeInto('PMTiles', bytes); bytes[7] = 3;
  writeUint64(view, 8, 127); writeUint64(view, 16, rootLength); writeUint64(view, 24, metadataOffset); writeUint64(view, 32, header.metadataLength); writeUint64(view, 40, 0); writeUint64(view, 48, 0); writeUint64(view, 56, tileOffset); writeUint64(view, 64, tileLength); writeUint64(view, 72, tileCount); writeUint64(view, 80, tileCount); writeUint64(view, 88, tileCount);
  bytes[96] = 1; bytes[97] = header.internalCompression; bytes[98] = header.tileCompression; bytes[99] = header.tileType; bytes[100] = header.minZoom; bytes[101] = header.maxZoom;
  view.setInt32(102, Math.round(header.minLon * 1e7), true); view.setInt32(106, Math.round(header.minLat * 1e7), true); view.setInt32(110, Math.round(header.maxLon * 1e7), true); view.setInt32(114, Math.round(header.maxLat * 1e7), true); bytes[118] = header.maxZoom; view.setInt32(119, Math.round(((header.minLon + header.maxLon) / 2) * 1e7), true); view.setInt32(123, Math.round(((header.minLat + header.maxLat) / 2) * 1e7), true); return bytes;
}

function findEntry(entries: Entry[], tileId: number): Entry | undefined { for (let i = entries.length - 1; i >= 0; i--) { const entry = entries[i]; if (entry.tileId <= tileId && (entry.runLength === 0 || tileId < entry.tileId + entry.runLength)) return entry; } return undefined; }

async function range(url: string, offset: number, length: number, stats: ExtractPmtilesProgress, signal?: AbortSignal, onProgress?: (progress: ExtractPmtilesProgress) => void): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal });
  if (!response.ok) throw new Error(`HTTP ${response.status} while reading PMTiles`);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (response.status === 200 && contentLength > length) throw new Error('Source does not support HTTP byte ranges');
  const bytes = new Uint8Array(await response.arrayBuffer()); stats.bytesTransferred += bytes.byteLength; stats.requestCount++; onProgress?.(stats); return bytes;
}

export async function extractPmtilesArea(options: ExtractPmtilesAreaOptions): Promise<ExtractPmtilesProgress> {
  const stats: ExtractPmtilesProgress = { bytesTransferred: 0, requestCount: 0, outputBytes: 0 }; const signal = options.signal;
  const target = new File(Paths.document, options.outputPath); const parent = new Directory(target.parentDirectory); const partial = new File(`${target.uri}.partial`);
  try {
    parent.create({ intermediates: true, idempotent: true }); partial.create({ overwrite: true, intermediates: true });
    const first = await range(options.sourceUrl, 0, 16384, stats, signal, options.onProgress); const header = parseHeader(first.slice(0, HEADER_SIZE));
    const root = decodeDirectory(first.slice(header.rootOffset, header.rootOffset + header.rootLength), header.internalCompression);
    const ids: number[] = []; const limit = Math.min(options.maxZoom, header.maxZoom);
    for (let z = header.minZoom; z <= limit; z++) { const size = 1 << z; const x0 = Math.max(0, Math.floor(lonToX(options.west, z))); const x1 = Math.min(size - 1, Math.floor(lonToX(options.east, z))); const y0 = Math.max(0, Math.floor(latToY(options.north, z))); const y1 = Math.min(size - 1, Math.floor(latToY(options.south, z))); for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) ids.push(zxyToTileId(z, x, y)); }
    const leafMap = new Map<number, Entry[]>(); for (const id of ids) { const entry = findEntry(root, id); if (entry?.runLength === 0 && !leafMap.has(entry.offset)) leafMap.set(entry.offset, []); }
    for (const leaf of leafMap.keys()) { const rootEntry = [...root].find((entry) => entry.offset === leaf && entry.runLength === 0); if (rootEntry) leafMap.set(leaf, decodeDirectory(await range(options.sourceUrl, header.leafOffset + leaf, rootEntry.length, stats, signal, options.onProgress), header.internalCompression)); }
    const selected: Entry[] = []; for (const id of ids) { const sourceDirectory = findEntry(root, id); const directory = sourceDirectory?.runLength === 0 ? leafMap.get(sourceDirectory.offset) : root; const entry = directory ? findEntry(directory, id) : sourceDirectory; if (entry?.runLength) selected.push({ tileId: id, offset: entry.offset, length: entry.length, runLength: 1 }); }
    selected.sort((a, b) => a.tileId - b.tileId); const merged: Entry[] = []; for (const entry of selected) { const previous = merged[merged.length - 1]; if (previous && previous.tileId + previous.runLength === entry.tileId && previous.offset === entry.offset && previous.length === entry.length) previous.runLength++; else merged.push(entry); }
    const metadata = await range(options.sourceUrl, header.metadataOffset, header.metadataLength, stats, signal, options.onProgress); const tileParts: Uint8Array[] = []; let tileLength = 0;
    const outputEntries: Entry[] = []; for (const entry of merged) { const tile = await range(options.sourceUrl, header.tileOffset + entry.offset, entry.length, stats, signal, options.onProgress); outputEntries.push({ ...entry, offset: tileLength }); tileParts.push(tile); tileLength += tile.byteLength; }
    const encodedDirectory = encodeEntries(outputEntries); const directoryBytes = header.internalCompression === 2 ? gzipSync(encodedDirectory) : encodedDirectory;
    const metadataOffset = HEADER_SIZE + directoryBytes.byteLength; const tileOffset = metadataOffset + metadata.byteLength; const handle = partial.open(FileMode.Truncate); handle.writeBytes(writeHeader(header, directoryBytes.byteLength, metadataOffset, tileOffset, tileLength, outputEntries.length)); handle.writeBytes(directoryBytes); handle.writeBytes(metadata); for (const tile of tileParts) { handle.writeBytes(tile); await Promise.resolve(); } handle.close(); if (target.exists) target.delete(); partial.move(target); stats.outputBytes = tileOffset + tileLength; options.onProgress?.(stats); return stats;
  } catch (error) { if (partial.exists) partial.delete(); throw error; }
}
