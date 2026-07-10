import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../../constants/theme';

const IMAGE_HEIGHT = 190;
const READABLE_LINE_HEIGHT_RATIO = 1.45;

interface ImagePromptCardProps {
  imagePath: string;
  question: string;
  metadata?: string;
}

export function ImagePromptCard({
  imagePath,
  question,
  metadata = 'Image processed locally',
}: ImagePromptCardProps) {
  return (
    <View style={styles.card}>
      <Image
        style={styles.image}
        source={{ uri: toPreviewUri(imagePath) }}
        contentFit="contain"
        transition={theme.animationTiming}
      />
      {question.trim() !== '' ? <Text style={styles.question}>{question.trim()}</Text> : null}
      <Text style={styles.metadata}>{metadata}</Text>
    </View>
  );
}

function toPreviewUri(path: string): string {
  if (path.startsWith('file://') || path.startsWith('content://')) {
    return path;
  }

  return `file://${path}`;
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 330,
    alignSelf: 'flex-end',
    overflow: 'hidden',
    borderRadius: theme.radiusMd,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  image: {
    width: '100%',
    height: IMAGE_HEIGHT,
    backgroundColor: theme.surface2,
  },
  question: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '600',
    lineHeight: theme.fontSizeMd * READABLE_LINE_HEIGHT_RATIO,
    paddingHorizontal: theme.space4,
    paddingTop: theme.space3,
  },
  metadata: {
    color: theme.textMuted,
    fontSize: theme.fontSizeXs,
    paddingHorizontal: theme.space4,
    paddingTop: theme.space1,
    paddingBottom: theme.space3,
  },
});
