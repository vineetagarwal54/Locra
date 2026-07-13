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
  scrim: 'rgba(0, 0, 0, 0.38)',

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

// ─────────────────────────────────────────────────────────────────────────────
// Approved design system tokens (constitution Principle XI). Derived from and
// must remain consistent with design/design.md — this module implements those
// values, it does not originate them. Screens and components migrated to the
// approved warm/light visual language import `designTokens` instead of the
// legacy dark `theme` above. Screens not yet migrated (onboarding, model
// setup, benchmark) keep using `theme` until a design-scoped feature updates
// them — do not repoint them at `designTokens` as an incidental part of
// unrelated work.
// ─────────────────────────────────────────────────────────────────────────────

export const designTokens = {
  // design.md §4.1
  color: {
    canvas: '#FBF9F6',
    surface: '#F5F3F1',
    surfaceStrong: '#FFFFFF',
    primary: '#334537',
    primarySoft: '#4A5D4E',
    textPrimary: '#202124',
    textSecondary: '#5E5E5C',
    border: '#C3C8C1',
    divider: '#E4E2E0',
    errorSurface: '#FFDAD6',
    error: '#9B131B',
    onPrimary: '#FFFFFF',
    onUserBubble: '#F7F7F3',
    // motion.md §10 DRAWER_SCRIM_OPACITY (0.38); design.md does not name a
    // scrim hue, so this stays a neutral dark overlay rather than a new color.
    scrim: 'rgba(32, 33, 36, 0.38)',
    // design.md §7.1 — the Welcome screen is the one intentionally dark
    // "charcoal/green" surface. It is not in the §4.1 table because it is
    // unique to that hero; derived to sit darker than `primary` so the
    // forest-green CTA and white hero title both read clearly on top of it.
    welcomeCanvas: '#1E241F',
    welcomeTextSecondary: 'rgba(247, 247, 243, 0.72)',
  },

  // design.md §4.2. Inter is the primary typeface, but no Inter font asset is
  // bundled — fontFamily is intentionally left unset so text falls through to
  // the documented fallback (platform system sans-serif) instead of silently
  // failing to resolve a missing font.
  type: {
    heroTitle: { fontSize: 34, fontWeight: '700', lineHeight: 39 },
    screenTitle: { fontSize: 28, fontWeight: '700', lineHeight: 33 },
    sectionTitle: { fontSize: 20, fontWeight: '600', lineHeight: 26 },
    cardTitle: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
    body: { fontSize: 15, fontWeight: '400', lineHeight: 22 },
    bodyStrong: { fontSize: 15, fontWeight: '600', lineHeight: 22 },
    supporting: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
    caption: { fontSize: 11, fontWeight: '500', lineHeight: 15 },
    button: { fontSize: 14, fontWeight: '600', lineHeight: 18 },
  },

  // design.md §4.3 — 8-point system with half steps.
  spacing: {
    space4: 4,
    space8: 8,
    space12: 12,
    space16: 16,
    space20: 20,
    space24: 24,
    space32: 32,
    space40: 40,
  },

  // design.md §4.4 — one concrete value chosen from each documented range.
  radius: {
    pill: 999,
    buttonPrimary: 20,
    card: 10,
    bubble: 10,
    bubbleTail: 4,
    composer: 14,
    circular: 999,
  },

  // design.md §4.5 — default border is 1dp; prefer border + surface contrast
  // over shadow.
  borderWidth: 1,
} as const;

export type DesignTokens = typeof designTokens;

// The only place `expo-haptics` is imported. Screens import these helpers from
// here rather than scattering feedback calls across the UI.
export const haptics = {
  capture: (): Promise<void> => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  success: (): Promise<void> => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  error: (): Promise<void> => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  tap: (): Promise<void> => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
};
