import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { designTokens, haptics } from '../../constants/theme';

export interface ConversationTargetOption {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: number;
}

interface ConversationTargetPickerProps {
  readonly options: readonly ConversationTargetOption[];
  readonly selectedId: string | null;
  readonly disabled: boolean;
  readonly onChange: (id: string | null) => void;
}

export function ConversationTargetPicker({
  options,
  selectedId,
  disabled,
  onChange,
}: ConversationTargetPickerProps) {
  const [visible, setVisible] = useState(false);
  const selected = useMemo(
    () => options.find((option) => option.id === selectedId) ?? null,
    [options, selectedId],
  );
  const deleted = selectedId !== null && selected === null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose a conversation for context"
        disabled={disabled}
        style={({ pressed }) => [
          styles.trigger,
          pressed && !disabled && styles.pressed,
          disabled && styles.disabled,
        ]}
        onPress={() => {
          void haptics.tap();
          setVisible(true);
        }}
      >
        <MaterialCommunityIcons name="magnify" size={17} color={designTokens.color.primary} />
        <Text style={[styles.triggerText, deleted && styles.error]} numberOfLines={1}>
          {deleted ? 'Conversation unavailable' : selected?.title ?? 'Use another conversation'}
        </Text>
        {selectedId !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear selected conversation"
            hitSlop={designTokens.spacing.space8}
            onPress={(event) => {
              event.stopPropagation();
              onChange(null);
            }}
          >
            <MaterialCommunityIcons name="close" size={17} color={designTokens.color.textSecondary} />
          </Pressable>
        ) : null}
      </Pressable>

      <Modal transparent animationType="fade" visible={visible} onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.scrim} onPress={() => setVisible(false)}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Conversation context</Text>
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {options.length === 0 ? (
                <Text style={styles.empty}>No previous conversations are available.</Text>
              ) : options.slice(0, 10).map((option) => (
                <Pressable
                  key={option.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: option.id === selectedId }}
                  style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                  onPress={() => {
                    onChange(option.id);
                    setVisible(false);
                  }}
                >
                  <MaterialCommunityIcons
                    name={option.id === selectedId ? 'radiobox-marked' : 'radiobox-blank'}
                    size={20}
                    color={designTokens.color.primary}
                  />
                  <View style={styles.optionBody}>
                    <Text style={styles.optionTitle} numberOfLines={1}>{option.title}</Text>
                    <Text style={styles.optionDate}>{new Date(option.updatedAt).toLocaleDateString()}</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable style={styles.done} onPress={() => setVisible(false)}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', maxWidth: '100%',
    minHeight: 40, paddingHorizontal: designTokens.spacing.space12,
    borderRadius: designTokens.radius.pill, borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border, backgroundColor: designTokens.color.surface,
    marginBottom: designTokens.spacing.space8,
  },
  triggerText: {
    flexShrink: 1, marginHorizontal: designTokens.spacing.space8,
    color: designTokens.color.textPrimary, fontSize: designTokens.type.supporting.fontSize,
  },
  error: { color: designTokens.color.error },
  pressed: { backgroundColor: designTokens.color.divider },
  disabled: { opacity: 0.45 },
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: designTokens.color.scrim },
  sheet: {
    maxHeight: '70%', padding: designTokens.spacing.space20,
    backgroundColor: designTokens.color.surfaceStrong,
    borderTopLeftRadius: designTokens.radius.card, borderTopRightRadius: designTokens.radius.card,
    borderTopWidth: designTokens.borderWidth, borderColor: designTokens.color.border,
  },
  title: {
    color: designTokens.color.textPrimary, fontSize: designTokens.type.bodyStrong.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight, marginBottom: designTokens.spacing.space12,
  },
  list: { flexGrow: 0 },
  option: {
    minHeight: 52, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: designTokens.spacing.space12, marginBottom: designTokens.spacing.space4,
  },
  optionBody: { flex: 1, marginLeft: designTokens.spacing.space12 },
  optionTitle: { color: designTokens.color.textPrimary, fontSize: designTokens.type.body.fontSize },
  optionDate: { color: designTokens.color.textSecondary, fontSize: designTokens.type.caption.fontSize },
  empty: { color: designTokens.color.textSecondary, paddingVertical: designTokens.spacing.space16 },
  done: {
    minHeight: 48, alignItems: 'center', justifyContent: 'center',
    marginTop: designTokens.spacing.space12, borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.primary,
  },
  doneText: { color: designTokens.color.onPrimary, fontWeight: designTokens.type.button.fontWeight },
});
