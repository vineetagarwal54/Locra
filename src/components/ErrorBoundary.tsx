import { Component, type ComponentType, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../constants/theme';

// Constitution Principle III: graceful degradation at every layer. A render-time
// crash anywhere below a screen resolves to a clean, legible fallback with a way
// forward — never a white screen or a hard crash.

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  private readonly handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.subtitle}>An unexpected error interrupted this screen.</Text>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
            onPress={this.handleRetry}
          >
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

/** Wraps a screen/component so its render errors are contained by the boundary. */
export function withErrorBoundary<P extends object>(Wrapped: ComponentType<P>): ComponentType<P> {
  function Boundaried(props: P): ReactNode {
    return (
      <ErrorBoundary>
        <Wrapped {...props} />
      </ErrorBoundary>
    );
  }
  Boundaried.displayName = `withErrorBoundary(${Wrapped.displayName ?? Wrapped.name ?? 'Component'})`;
  return Boundaried;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.canvas,
    padding: theme.space6,
  },
  title: {
    color: theme.error,
    fontSize: theme.fontSizeLg,
    fontWeight: '600',
    marginBottom: theme.space2,
  },
  subtitle: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    textAlign: 'center',
    marginBottom: theme.space5,
  },
  retry: {
    paddingVertical: theme.space3,
    paddingHorizontal: theme.space5,
    borderRadius: theme.radiusMd,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
    backgroundColor: theme.accentGlow,
  },
  retryPressed: {
    backgroundColor: theme.surface2,
  },
  retryLabel: {
    color: theme.accent,
    fontSize: theme.fontSizeMd,
    fontWeight: '600',
  },
});
