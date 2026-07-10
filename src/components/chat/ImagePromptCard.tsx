import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { haptics, theme } from '../../constants/theme';

const IMAGE_HEIGHT = 190;
const READABLE_LINE_HEIGHT_RATIO = 1.45;

interface ImagePromptCardProps {
  imagePath: string;
  question: string;
  metadata?: string;
  onRemove?: () => void;
}

export function ImagePromptCard({
  imagePath,
  question,
  metadata = 'Image processed locally',
  onRemove,
}: ImagePromptCardProps) {
  return (
    <View style={styles.card}>
      <View>
        <Image
          style={styles.image}
          source={{ uri: toPreviewUri(imagePath) }}
          contentFit="contain"
          transition={theme.animationTiming}
        />
        {onRemove !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove attached image"
            style={({ pressed }) => [styles.removeButton, pressed && styles.removeButtonPressed]}
            onPress={() => {
              void haptics.tap();
              onRemove();
            }}
          >
            <MaterialCommunityIcons name="close" size={18} color={theme.textPrimary} />
          </Pressable>
        ) : null}
      </View>
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
  removeButton: {
    position: 'absolute',
    top: theme.space2,
    right: theme.space2,
    width: theme.space6,
    height: theme.space6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radiusPill,
    backgroundColor: theme.scrim,
  },
  removeButtonPressed: {
    backgroundColor: theme.surface3,
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
