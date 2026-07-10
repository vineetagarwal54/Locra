import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { designTokens } from '../../constants/theme';

const DOT_SIZE = 5;
const DOT_CYCLE_MS = 1000;
const DOT_RISE = -2;

interface StreamingMessageProps {
  label?: string;
}

export function StreamingMessage({ label = 'Thinking on-device...' }: StreamingMessageProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.dots} accessibilityLabel={label} accessible>
        <AnimatedDot delay={0} />
        <AnimatedDot delay={140} />
        <AnimatedDot delay={280} />
      </View>
    </View>
  );
}

function AnimatedDot({ delay }: { delay: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: DOT_CYCLE_MS / 2 }),
          withTiming(0, { duration: DOT_CYCLE_MS / 2 })
        ),
        -1,
        false
      )
    );

    return () => {
      cancelAnimation(progress);
    };
  }, [delay, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.45 + progress.value * 0.55,
    transform: [{ translateY: progress.value * DOT_RISE }],
  }));

  return <Animated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    marginRight: designTokens.spacing.space8,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.primary,
    marginRight: designTokens.spacing.space4,
  },
});
