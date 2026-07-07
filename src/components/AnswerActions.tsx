import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { haptics, theme } from '../constants/theme';

// The action row under a completed answer — Copy, Share, Flag — in the compact,
// low-chrome style of the ChatGPT / Claude message toolbar. All three actions
// are local and side-effect-free for navigation: nothing here leaves the
// current screen (FR-031, FR-032), and Share sends plain text only, never the
// image and never over the network (the OS share sheet is the user's choice).

const COPIED_RESET_MS = 1600;

/** Plain-text form of one question/answer pair for the native share sheet (FR-032). */
export function buildShareText(question: string, answer: string): string {
  return `Q: ${question.trim()}\n\nA: ${answer.trim()}`;
}

interface AnswerActionsProps {
  question: string;
  answer: string;
  flagged: boolean;
  flagDisabled: boolean;
  onFlag: () => void;
}

export function AnswerActions({
  question,
  answer,
  flagged,
  flagDisabled,
  onFlag,
}: AnswerActionsProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) {
        clearTimeout(copiedTimer.current);
      }
    };
  }, []);

  const onCopy = (): void => {
    void Clipboard.setStringAsync(answer);
    void haptics.success();
    setCopied(true);
    if (copiedTimer.current !== null) {
      clearTimeout(copiedTimer.current);
    }
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  };

  const onShare = (): void => {
    void haptics.tap();
    void Share.share({ message: buildShareText(question, answer) }).catch(() => {
      // User dismissing the sheet is not an error worth surfacing.
    });
  };

  return (
    <View style={styles.row}>
      <ActionButton
        icon={copied ? 'check' : 'content-copy'}
        label={copied ? 'Copied' : 'Copy'}
        active={copied}
        accessibilityLabel="Copy answer"
        onPress={onCopy}
      />
      <ActionButton
        icon="share-variant-outline"
        label="Share"
        accessibilityLabel="Share answer"
        onPress={onShare}
      />
      <ActionButton
        icon={flagged ? 'flag' : 'flag-outline'}
        label={flagged ? 'Flagged' : 'Flag'}
        active={flagged}
        disabled={flagDisabled}
        accessibilityLabel={flagged ? 'Answer flagged' : 'Flag bad answer'}
        onPress={onFlag}
      />
    </View>
  );
}

interface ActionButtonProps {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  accessibilityLabel: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

function ActionButton({
  icon,
  label,
  accessibilityLabel,
  active = false,
  disabled = false,
  onPress,
}: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      hitSlop={theme.space2}
      style={({ pressed }) => [
        styles.button,
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
      onPress={onPress}
    >
      <MaterialCommunityIcons
        name={icon}
        size={theme.fontSizeMd}
        color={active ? theme.success : theme.textSecondary}
      />
      <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space2,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space1,
    minHeight: theme.space6 + theme.space2,
    paddingHorizontal: theme.space3,
    paddingVertical: theme.space2,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  buttonPressed: {
    backgroundColor: theme.surface3,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  label: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeXs,
    fontWeight: '700',
  },
  labelActive: {
    color: theme.success,
  },
});
