import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { designTokens, haptics } from '../constants/theme';

export type LocraSheetActionVariant = 'primary' | 'default' | 'destructive' | 'quiet';

export interface LocraSheetAction {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: LocraSheetActionVariant;
}

interface LocraSheetProps {
  readonly visible: boolean;
  readonly title?: string;
  readonly message?: string;
  readonly actions?: readonly LocraSheetAction[];
  readonly onRequestClose: () => void;
  readonly children?: ReactNode;
}

// The single Locra-styled bottom sheet / dialog. Replaces native Android alerts
// and every bespoke chat modal so confirmations, disclosures, and pickers share
// one warm, tokenized surface (Principle XI). Declarative: the caller owns the
// `visible` flag and dismisses via `onRequestClose`.
export function LocraSheet({
  visible,
  title,
  message,
  actions = [],
  onRequestClose,
  children,
}: LocraSheetProps) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onRequestClose}>
      <Pressable style={styles.scrim} onPress={onRequestClose} accessibilityLabel="Dismiss">
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.handle} />
          {title !== undefined ? <Text style={styles.title}>{title}</Text> : null}
          {message !== undefined ? <Text style={styles.message}>{message}</Text> : null}
          {children}
          {actions.length > 0 ? (
            <View style={styles.actions}>
              {actions.map((action) => (
                <SheetButton key={action.label} action={action} />
              ))}
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetButton({ action }: { action: LocraSheetAction }) {
  const variant = action.variant ?? 'default';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'destructive' && styles.buttonDestructive,
        variant === 'quiet' && styles.buttonQuiet,
        pressed && styles.buttonPressed,
      ]}
      onPress={() => {
        void haptics.tap();
        action.onPress();
      }}
    >
      <Text
        style={[
          styles.buttonLabel,
          variant === 'primary' && styles.buttonLabelPrimary,
          variant === 'destructive' && styles.buttonLabelDestructive,
          variant === 'quiet' && styles.buttonLabelQuiet,
        ]}
      >
        {action.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: designTokens.color.scrim,
  },
  sheet: {
    paddingHorizontal: designTokens.spacing.space20,
    paddingTop: designTokens.spacing.space12,
    paddingBottom: designTokens.spacing.space24,
    backgroundColor: designTokens.color.surfaceStrong,
    borderTopLeftRadius: designTokens.radius.card,
    borderTopRightRadius: designTokens.radius.card,
    borderTopWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
  },
  handle: {
    alignSelf: 'center',
    width: designTokens.spacing.space32,
    height: designTokens.spacing.space4,
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.divider,
    marginBottom: designTokens.spacing.space16,
  },
  title: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.sectionTitle.fontSize,
    fontWeight: designTokens.type.sectionTitle.fontWeight,
    marginBottom: designTokens.spacing.space8,
  },
  message: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.body.fontSize,
    lineHeight: designTokens.type.body.lineHeight,
    marginBottom: designTokens.spacing.space8,
  },
  actions: {
    marginTop: designTokens.spacing.space12,
  },
  button: {
    minHeight: designTokens.spacing.space24 * 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: designTokens.spacing.space16,
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    marginTop: designTokens.spacing.space8,
  },
  buttonPrimary: {
    backgroundColor: designTokens.color.primary,
    borderColor: designTokens.color.primary,
  },
  buttonDestructive: {
    backgroundColor: designTokens.color.errorSurface,
    borderColor: designTokens.color.error,
  },
  buttonQuiet: {
    backgroundColor: designTokens.color.surfaceStrong,
    // Match the surface so the quiet action reads as borderless without a literal.
    borderColor: designTokens.color.surfaceStrong,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonLabel: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.button.fontSize,
    fontWeight: designTokens.type.button.fontWeight,
  },
  buttonLabelPrimary: {
    color: designTokens.color.onPrimary,
  },
  buttonLabelDestructive: {
    color: designTokens.color.error,
  },
  buttonLabelQuiet: {
    color: designTokens.color.textSecondary,
  },
});
