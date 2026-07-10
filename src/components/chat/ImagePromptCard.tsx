import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { designTokens, haptics, theme } from '../../constants/theme';

const IMAGE_HEIGHT = 190;

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
            <MaterialCommunityIcons name="close" size={18} color={designTokens.color.onPrimary} />
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
    borderRadius: designTokens.radius.card,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    backgroundColor: designTokens.color.surfaceStrong,
  },
  image: {
    width: '100%',
    height: IMAGE_HEIGHT,
    backgroundColor: designTokens.color.surface,
  },
  removeButton: {
    position: 'absolute',
    top: designTokens.spacing.space8,
    right: designTokens.spacing.space8,
    width: designTokens.spacing.space24,
    height: designTokens.spacing.space24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.error,
  },
  removeButtonPressed: {
    opacity: 0.85,
  },
  question: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.bodyStrong.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
    lineHeight: designTokens.type.bodyStrong.lineHeight,
    paddingHorizontal: designTokens.spacing.space16,
    paddingTop: designTokens.spacing.space12,
  },
  metadata: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.caption.fontSize,
    paddingHorizontal: designTokens.spacing.space16,
    paddingTop: designTokens.spacing.space4,
    paddingBottom: designTokens.spacing.space12,
  },
});
