import {
  Camera,
  Layer,
  Map,
  VectorSource,
} from "@maplibre/maplibre-react-native";
import { File, Paths } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import { useEffect, useState } from 'react';
import { Button, StyleSheet, Text, View } from "react-native";

import { extractPmtilesArea, type ExtractPmtilesProgress } from '../spikes/pmtiles/extractPmtilesArea';

const OUTPUT_PATH = 'files/maps/android-test-area.pmtiles';

function getOutputFileState(): { uri: string; size: number; exists: boolean } {
  const file = new File(Paths.document, OUTPUT_PATH);
  const size = file.size ?? 0;
  return { uri: file.uri, size, exists: file.exists && size > 0 };
}

const mapStyle = {
  version: 8 as const,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background" as const,
      paint: {
        "background-color": "#F1EFE8",
      },
    },
  ],
};

export function PmtilesSpikeScreen() {
  const [fileUri, setFileUri] = useState(`${FileSystem.documentDirectory}maps/test-area.pmtiles`);
  const [hasOutputFile, setHasOutputFile] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [progress, setProgress] = useState<ExtractPmtilesProgress>({ bytesTransferred: 0, requestCount: 0, outputBytes: 0 });
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const outputFile = getOutputFileState();
    setHasOutputFile(outputFile.exists);
    if (outputFile.exists) {
      setFileUri(outputFile.uri);
      setProgress((current) => ({ ...current, outputBytes: outputFile.size }));
      setStatus('Complete');
    }
  }, []);

  useEffect(() => {
    if (startedAt === null) return undefined;
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 250);
    return () => clearInterval(timer);
  }, [startedAt]);

  async function extract(): Promise<void> {
    const start = Date.now(); setStartedAt(start); setElapsed(0); setStatus('Extracting…');
    try {
      const result = await extractPmtilesArea({ sourceUrl: 'https://build.protomaps.com/20260718.pmtiles', outputPath: OUTPUT_PATH, west: -77.0004, south: 38.9420, east: -76.8848, north: 39.0318, maxZoom: 15, onProgress: setProgress });
      setProgress(result); setFileUri(`${FileSystem.documentDirectory}${OUTPUT_PATH}`); setStatus('Complete');
      const outputFile = getOutputFileState();
      setHasOutputFile(outputFile.exists);
      setProgress((current) => ({ ...current, outputBytes: outputFile.size }));
    } catch (error) { setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setElapsed(Date.now() - start); setStartedAt(null); }
  }

  return (
    <View style={styles.container}>
      <View style={styles.controls}>
        <Button title={hasOutputFile ? 'Open Resulting Archive' : 'Extract Test Area'} onPress={() => { if (hasOutputFile) setFileUri(getOutputFileState().uri); else void extract(); }} disabled={startedAt !== null} />
        <Text>{status}</Text>
        <Text>Elapsed: {(elapsed / 1000).toFixed(1)}s</Text>
        <Text>Transferred: {(progress.bytesTransferred / 1024 / 1024).toFixed(2)} MB · Output: {(progress.outputBytes / 1024 / 1024).toFixed(2)} MB · Requests: {progress.requestCount}</Text>
      </View>
      <Map style={styles.map} mapStyle={mapStyle}>
        <Camera
          initialViewState={{
            center: [-76.9426, 38.9897],
            zoom: 12,
          }}
        />

        <VectorSource
          id="protomaps"
          url={`pmtiles://${fileUri}`}
          minzoom={0}
          maxzoom={15}
        >
          <Layer
            id="earth"
            type="fill"
            source-layer="earth"
            paint={{
              "fill-color": "#F1EFE8",
            }}
          />

          <Layer
            id="water"
            type="fill"
            source-layer="water"
            paint={{
              "fill-color": "#A8D5E5",
            }}
          />

          <Layer
            id="landuse"
            type="fill"
            source-layer="landuse"
            paint={{
              "fill-color": "#DDE8D2",
              "fill-opacity": 0.6,
            }}
          />

          <Layer
            id="roads"
            type="line"
            source-layer="roads"
            paint={{
              "line-color": "#FFFFFF",
              "line-width": 2,
            }}
          />

          <Layer
            id="buildings"
            type="fill"
            source-layer="buildings"
            minzoom={13}
            paint={{
              "fill-color": "#D2CBC3",
              "fill-outline-color": "#B8B0A8",
            }}
          />
        </VectorSource>
      </Map>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  controls: {
    gap: 6,
    padding: 12,
    backgroundColor: '#F1EFE8',
  },
});
