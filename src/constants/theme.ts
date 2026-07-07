import * as Haptics from 'expo-haptics';

// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for the design system (constitution Principle XI).
// Every screen and component references `theme.*` only — no hardcoded hex values
// and no magic numbers for colors, spacing, radii, or type scale live anywhere
// else. Change a value here and it propagates across the whole app.
// ─────────────────────────────────────────────────────────────────────────────

export const theme = {
  // Canvas & surfaces
  canvas: '#0f0f0f',
  surface: '#1a1a1a',
  surface2: '#232323',
  surface3: '#2e2e2e',

  // Accent — change this one value to retheme the entire app
  accent: '#7C5CFC',
  accentDim: '#5B3DD4',
  accentGlow: 'rgba(124, 92, 252, 0.15)',
  accentBorder: 'rgba(124, 92, 252, 0.30)',

  // Text
  textPrimary: '#F0EDE8',
  textSecondary: '#9E9A94',
  textMuted: '#5A5750',

  // Borders
  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(255, 255, 255, 0.14)',

  // Semantic
  error: '#FF5E57',
  errorGlow: 'rgba(255, 94, 87, 0.15)',
  success: '#00D4A4',

  // Radius
  radiusLg: 14,
  radiusMd: 10,
  radiusSm: 6,
  radiusPill: 999,

  // Spacing (base unit: 4)
  space1: 4,
  space2: 8,
  space3: 12,
  space4: 16,
  space5: 20,
  space6: 24,

  // Typography
  fontSizeXs: 11,
  fontSizeSm: 13,
  fontSizeMd: 15,
  fontSizeLg: 20,
  fontSizeXl: 28,

  // Motion
  animationSpring: { damping: 15, stiffness: 150 },
  animationTiming: 200,
  blurCameraBar: 20,
} as const;

export type Theme = typeof theme;

// The only place `expo-haptics` is imported. Screens import these helpers from
// here rather than scattering feedback calls across the UI.
export const haptics = {
  capture: (): Promise<void> => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  success: (): Promise<void> => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  error: (): Promise<void> => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  tap: (): Promise<void> => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
};
