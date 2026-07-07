import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { theme } from '../../constants/theme';
import type { ObjectiveInferenceResultRecord } from '../../inference/ObjectiveInferenceResultRecord';
import type { ManualScore } from '../QualityEvalSchemas';

export interface EvaluationRecorderScreenProps {
  objectiveRecord: ObjectiveInferenceResultRecord | null;
  caseId: string;
  subjectiveDraft: Partial<ManualScore>;
  onCaseIdChange: (caseId: string) => void;
  onSubjectiveChange: (draft: Partial<ManualScore>) => void;
  onSave: () => void;
}

export default function EvaluationRecorderScreen({
  objectiveRecord,
  caseId,
  subjectiveDraft,
  onCaseIdChange,
  onSubjectiveChange,
  onSave,
}: EvaluationRecorderScreenProps): React.ReactElement {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Evaluation Recorder</Text>
      <TextInput
        style={styles.input}
        value={caseId}
        onChangeText={onCaseIdChange}
        placeholder="caseId"
        placeholderTextColor={theme.textMuted}
      />
      <Text style={styles.output} numberOfLines={4}>
        {objectiveRecord?.answerText ?? 'No completed result'}
      </Text>
      <View style={styles.row}>
        <Toggle
          label="Direct"
          value={subjectiveDraft.directAnswer}
          onPress={() => onSubjectiveChange({ directAnswer: !subjectiveDraft.directAnswer })}
        />
        <Toggle
          label="Correct"
          value={subjectiveDraft.coreCorrectness}
          onPress={() => onSubjectiveChange({ coreCorrectness: !subjectiveDraft.coreCorrectness })}
        />
        <Toggle
          label="Hallucination"
          value={subjectiveDraft.hallucination}
          onPress={() => onSubjectiveChange({ hallucination: !subjectiveDraft.hallucination })}
        />
      </View>
      <View style={styles.row}>
        {[1, 2, 3, 4, 5].map((value) => (
          <Pressable
            key={value}
            style={[
              styles.score,
              subjectiveDraft.usefulness === value ? styles.scoreSelected : null,
            ]}
            onPress={() => onSubjectiveChange({ usefulness: value })}
          >
            <Text style={styles.scoreText}>{value}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        style={[styles.input, styles.notes]}
        value={subjectiveDraft.notes ?? ''}
        onChangeText={(notes) => onSubjectiveChange({ notes })}
        placeholder="notes"
        placeholderTextColor={theme.textMuted}
        multiline
      />
      <Pressable style={styles.saveButton} onPress={onSave}>
        <Text style={styles.saveText}>Save Result</Text>
      </Pressable>
    </View>
  );
}

interface ToggleProps {
  label: string;
  value: boolean | undefined;
  onPress: () => void;
}

function Toggle({ label, value, onPress }: ToggleProps): React.ReactElement {
  return (
    <Pressable style={[styles.toggle, value === true ? styles.toggleOn : null]} onPress={onPress}>
      <Text style={styles.toggleText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.canvas,
    padding: theme.space4,
    gap: theme.space3,
  },
  title: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeLg,
    fontWeight: '600',
  },
  input: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderRadius: theme.radiusMd,
    borderWidth: 1,
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    padding: theme.space3,
  },
  output: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
  },
  row: {
    flexDirection: 'row',
    gap: theme.space2,
  },
  toggle: {
    backgroundColor: theme.surface2,
    borderRadius: theme.radiusMd,
    padding: theme.space3,
  },
  toggleOn: {
    backgroundColor: theme.accentDim,
  },
  toggleText: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeSm,
  },
  score: {
    alignItems: 'center',
    backgroundColor: theme.surface2,
    borderRadius: theme.radiusPill,
    justifyContent: 'center',
    minHeight: theme.space6,
    minWidth: theme.space6,
  },
  scoreSelected: {
    backgroundColor: theme.accentDim,
  },
  scoreText: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeSm,
  },
  notes: {
    minHeight: theme.space6 * 3,
    textAlignVertical: 'top',
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: theme.accent,
    borderRadius: theme.radiusMd,
    padding: theme.space3,
  },
  saveText: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '600',
  },
});
