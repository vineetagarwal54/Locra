import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { designTokens, haptics, theme } from '../../constants/theme';

const IMAGE_HEIGHT = 190;

interface ImagePromptCardProps {
  imagePath: string;
  question: string;
  metadata?: string;
  available?: boolean;
  onRemove?: () => void;
  onRetake?: () => void;
}

export function ImagePromptCard({
  imagePath,
  question,
  metadata = 'Image processed locally',
  available = true,
  onRemove,
  onRetake,
}: ImagePromptCardProps) {
  const [previewVisible, setPreviewVisible] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const originalAvailable = available && !loadFailed;

  useEffect(() => {
    setLoadFailed(false);
    setPreviewVisible(false);
  }, [imagePath]);

  return (
    <>
      <View style={styles.card}>
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={originalAvailable ? 'Preview original image' : 'Original image unavailable'}
            disabled={!originalAvailable}
            onPress={() => setPreviewVisible(true)}
          >
            {originalAvailable ? (
              <Image
                style={styles.image}
                source={{ uri: toPreviewUri(imagePath) }}
                contentFit="contain"
                transition={theme.animationTiming}
                onError={() => setLoadFailed(true)}
              />
            ) : (
              <View style={styles.unavailable}>
                <MaterialCommunityIcons
                  name="image-off-outline"
                  size={32}
                  color={designTokens.color.textSecondary}
                />
                <Text style={styles.unavailableText}>Original image unavailable</Text>
              </View>
            )}
          </Pressable>
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
        {question.trim() !== '' ? <Text selectable style={styles.question}>{question.trim()}</Text> : null}
        <Text style={styles.metadata}>{originalAvailable ? metadata : 'Stored evidence remains available'}</Text>
        {onRetake !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retake attached image"
            style={({ pressed }) => [styles.retakeButton, pressed && styles.retakeButtonPressed]}
            onPress={() => {
              void haptics.tap();
              onRetake();
            }}
          >
            <MaterialCommunityIcons name="camera-retake-outline" size={18} color={designTokens.color.primary} />
            <Text style={styles.retakeText}>Retake</Text>
          </Pressable>
        ) : null}
      </View>

      <Modal
        visible={previewVisible && originalAvailable}
        animationType="fade"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <View style={styles.previewRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close image preview"
            style={styles.previewClose}
            onPress={() => setPreviewVisible(false)}
          >
            <MaterialCommunityIcons name="close" size={24} color={designTokens.color.textPrimary} />
          </Pressable>
          <Image
            style={styles.previewImage}
            source={{ uri: toPreviewUri(imagePath) }}
            contentFit="contain"
            onError={() => {
              setLoadFailed(true);
              setPreviewVisible(false);
            }}
          />
        </View>
      </Modal>
    </>
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
  unavailable: {
    height: IMAGE_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: designTokens.color.surface,
  },
  unavailableText: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    marginTop: designTokens.spacing.space8,
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
  retakeButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: designTokens.spacing.space16,
  },
  retakeButtonPressed: {
    opacity: 0.7,
  },
  retakeText: {
    color: designTokens.color.primary,
    fontSize: designTokens.type.supporting.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
    marginLeft: designTokens.spacing.space8,
  },
  previewRoot: {
    flex: 1,
    backgroundColor: designTokens.color.canvas,
  },
  previewClose: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    margin: designTokens.spacing.space16,
  },
  previewImage: {
    flex: 1,
    width: '100%',
    marginBottom: designTokens.spacing.space24,
  },
});
