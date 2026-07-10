# Locra Motion Specification
**Status:** Finalized motion direction  
**Platform:** Android-first React Native  
**Use with:** `design.md` and `screen_map.md`

## 1. Purpose
This file defines how Locra moves. It covers:
- motion principles
- duration and easing tokens
- navigation transitions
- onboarding motion
- model-download motion
- drawer behavior
- chat send/generation/streaming behavior
- image interactions
- History behavior
- reduced-motion behavior
- implementation guardrails

Motion must support understanding. It should never become the focus of the experience.

## 2. Motion Direction
Locra motion should feel calm, fast to respond, quiet, predictable, efficient, and native to mobile.

> Motion explains what changed, where it came from, or what the system is doing.

Do not add motion only to make the interface feel more “AI” or “premium.”

## 3. Principles
### 3.1 Purpose before decoration
Animation should acknowledge input, show state change, communicate progress, preserve spatial continuity, explain navigation, or reduce abruptness. Otherwise, remove it.

### 3.2 Immediate feedback
Feedback begins immediately after touch:
- button press reacts immediately
- drawer follows the finger
- sent message appears immediately
- generation indicator starts when inference starts
- progress reflects actual state

### 3.3 Inference-aware motion
During model loading, inference, camera processing, or local speech processing:
- stop nonessential looping motion
- avoid JS-driven animation loops
- prioritize scrolling and text rendering
- keep generation feedback lightweight

### 3.4 No fake AI spectacle
Do not use:
- WebGL shaders
- animated neural particles
- glowing AI orbs
- scanning beams
- looping logo pulses
- continuously shifting gradients
- fake progress
- decorative shimmer on major surfaces

### 3.5 Spatial consistency
- drawer enters from the left
- History behaves as a forward destination
- back reverses that direction
- confirmations use fade + slight scale
- image continuity may use a shared transition only if stable

## 4. Motion Tokens
### 4.1 Durations
| Token | Duration | Use |
|---|---:|---|
| `motion.press` | 100 ms | Press feedback |
| `motion.micro` | 150 ms | Small fades and message entry |
| `motion.quick` | 200 ms | Compact state transitions |
| `motion.standard` | 250 ms | Default component transition |
| `motion.navigation` | 300 ms | Navigation and drawer |
| `motion.emphasis` | 400 ms | Rare setup-completion emphasis |

Most motion should remain between 100 and 300 ms. Do not use 500–600 ms transitions for normal navigation.

### 4.2 Easing
**Standard**
```text
cubic-bezier(0.2, 0.0, 0.0, 1.0)
```
Use for fades, card-state changes, small translations, and content entry.

**Decelerate**
```text
cubic-bezier(0.0, 0.0, 0.2, 1.0)
```
Use for entering drawer, destination screens, modal surfaces, and notification preview.

**Accelerate**
```text
cubic-bezier(0.4, 0.0, 1.0, 1.0)
```
Use for exiting drawer, dismissed attachment, and transient feedback.

### 4.3 Springs
Spring motion is allowed only for:
- drawer settle after gesture
- direct-manipulation release
- optional shared-image settle
- one-time success icon settle

Requirements:
- low overshoot
- quick settling
- no repeated bounce

Do not use springs for streaming text, progress bars, onboarding rows, or every message.

## 5. Performance Rules
Prefer:
- UI-thread-capable animation
- Reanimated where appropriate
- native navigation transitions
- gesture-handler-driven drawer interaction
- opacity and transform animation

Avoid:
- JS per-frame loops
- React state updates for animation frames
- animated blur
- heavy Lottie for simple state changes
- continuously animated shadows
- full-screen gradient interpolation during inference

Progress bars may animate width or `scaleX` if implemented efficiently.

## 6. Global Transitions
### Forward navigation
Use for onboarding progression and forward destinations:
- incoming translateX: 16–24 dp → 0
- incoming opacity: 0.85 → 1
- duration: 250–300 ms
- standard/decelerate easing

Do not turn onboarding into a full-width carousel unless the navigation framework already requires it.

### Back navigation
Reverse the spatial relationship. Use native Android back behavior where appropriate.

### Modal/confirmation
Use for cancel/download or destructive confirmation:
- backdrop fade in
- surface scale 0.97 → 1
- surface opacity 0 → 1
- duration 200–250 ms
- no bounce

### State replacement
For transitions such as preparing → downloading, downloading → verifying, or generation indicator → answer:
- preserve container position
- crossfade labels/content in 150–200 ms
- avoid full layout replacement where unnecessary

# 7. Onboarding
## 7.1 Welcome
One-time entry:
| Element | Motion | Delay |
|---|---|---:|
| Title | fade + 8 dp rise | 0 ms |
| Subtitle | fade + 6 dp rise | 60 ms |
| CTA | fade + 6 dp rise | 120 ms |

Duration: 250–300 ms. After entry, the screen remains still.

Do not use WebGL shader, breathing background, color drift, or looping icon pulse.

## 7.2 Privacy
Entry order:
1. icon
2. title
3. benefit rows
4. CTA

Benefit rows:
- opacity 0 → 1
- translateY 10 dp → 0
- duration 220–250 ms
- stagger 40–50 ms

Animation must not block interaction.

## 7.3 Model Download Introduction
Grouped entry:
1. icon
2. title/body
3. metadata card
4. actions

Use fade + maximum 8 dp rise over 200–250 ms. No spring or bounce.

## 7.4 Notification Rationale
Notification preview:
- translateY -12 dp → 0
- opacity 0 → 1
- duration 250 ms

Do not make it fall from outside the screen. Shield icon may use one subtle 0.96 → 1 scale acknowledgement, but no repeated pulse.

After `Allow notifications`, open the OS prompt promptly. Do not delay it with a long animation.

## 7.5 Download Progress
Progress must reflect real state.

**Progress fill**
- interpolate toward real reported progress
- 150–300 ms per update
- linear or near-linear easing
- never continue moving without real progress
- never replay from 0 after reconnecting to an existing download

**Percentage**
Update directly. Do not use rolling-number animation.

**Activity feedback**
Do not use continuous shimmer. One restrained indicator is enough:
- small activity dots near status text, or
- compact indeterminate indicator during preparation/reconnection

**Phase changes**
For `DOWNLOADING`, `VERIFYING`, and `COMPLETE`, use 150–200 ms label crossfade while preserving card layout.

**Reconnection**
- show persisted/current progress immediately
- do not animate from zero
- resume interpolation from current state

**Completion**
1. progress reaches 100%
2. status changes to complete
3. short 150–250 ms stabilization
4. navigate to Success in 250–300 ms

Do not morph the progress bar into a glowing effect.

## 7.6 Success
Entry:
- success icon fade + scale 0.92 → 1
- title fade + 6 dp rise
- subtitle fade
- CTA fade

Total entry should finish within about 400 ms.

`Start chatting` uses normal forward navigation, 250–300 ms. Do not use a 600 ms crossfade.

# 8. Error and Recovery
## Insufficient Storage
Entry:
- error icon fade/scale once
- title/body fade
- actions appear quickly

Do not shake the full screen.

### Retry
When tapped:
- button transitions to loading in 150 ms
- optional text: `Checking…`
- recheck storage

If still insufficient:
- return to Retry state
- optional light error haptic
- no repeated card shake

If resolved:
- navigate back to setup/download in 250–300 ms

# 9. Controls
## Primary button
Press:
- scale 1 → 0.985
- 80–100 ms

Release:
- return to 1
- 100–120 ms

Do not delay the action until animation finishes.

## Icon button
Use:
- opacity or tonal change
- optional scale 1 → 0.94
- 100 ms

## Suggestion card / history row
Use:
- scale 1 → 0.99
- subtle surface change
- 100 ms

Avoid bounce or strong compression.

# 10. Conversation Drawer
## Open
- translateX -100% → 0
- scrim opacity 0 → approximately 0.38
- duration 250–300 ms
- decelerate easing

## Gesture
When gesture dismissal is supported:
- drawer follows finger directly
- scrim opacity tracks drawer position
- release uses velocity and distance threshold
- settle uses low-overshoot spring

## Close
- drawer moves to -100%
- scrim fades to 0
- duration 200–250 ms
- accelerate easing

Selecting a conversation may begin loading while the drawer closes. Avoid unnecessary wait chains.

# 11. Chat
## 11.1 Sending a user message
The message appears immediately:
- opacity 0 → 1
- translateY 6 dp → 0
- 150 ms

No spring and no floating animation from the composer.

After insertion:
- composer clears accepted content
- generation state begins

## 11.2 Composer clear and resize
After successful send:
- clear text immediately
- move attachment ownership to sent message before removing it from composer state
- composer returns to normal height over 150–200 ms if needed

Do not clear an attachment before message state safely owns it.

## 11.3 Generation state
Preferred feedback:
`Thinking on-device…`

Use a small three-dot activity indicator:
- opacity sequencing
- maximum 2 dp vertical movement
- 900–1200 ms cycle

Stop immediately when visible output begins or generation ends.

Do not use:
- text shimmer
- glowing orb
- pulsing avatar
- random rotating status phrases

Meaningful real phases may be shown:
- `Preparing image…`
- `Looking at image…`
- `Thinking on-device…`

Do not expose internal prompt-stage names.

## 11.4 First assistant output
When first output appears:
- generation indicator fades out in 100–150 ms
- assistant container appears once
- content begins streaming

Do not spring the message on every update.

## 11.5 Streaming text
Requirements:
- append content without per-token animation
- do not fade individual tokens
- do not move the whole message on each update
- avoid layout jitter
- optional subtle caret/activity marker is allowed

The assistant container enters once; internal text updates naturally.

## 11.6 Auto-scroll
When the user is near bottom:
- follow streamed content
- use short controlled scroll adjustments

When the user scrolls upward:
- stop auto-following
- preserve reading position
- optional `Jump to latest` control

Do not force the user back to bottom after generation completes.

## 11.7 Restored conversations
Do not animate historical messages one by one. Render normally, with at most one screen-level fade.

# 12. Composer
## Focus
- follow system keyboard behavior
- remain anchored above keyboard
- optional border/focus transition in 150 ms
- no bounce

## Multi-line expansion
- adjust height over 100–150 ms
- cap at configured maximum
- scroll internally after max height

## Locked during inference
- preserve composer position
- transition send/control state to disabled in 150 ms
- preserve unsent draft text
- do not gray out the full screen

When inference completes:
- restore enabled state in 150 ms
- do not steal keyboard focus automatically

# 13. Image Motion
## Attachment entry
When image is selected or captured:
- opacity 0 → 1
- scale 0.96 → 1
- 150–200 ms

Remove control appears immediately or within 50 ms.

## Removal
- opacity 1 → 0
- scale 1 → 0.96
- 120–150 ms
- collapse attachment area smoothly if needed

State removal must happen promptly enough to prevent accidental sending.

## Shared transition
A shared-element transition is optional. Use only if stable on Android, smooth on target devices, compatible with navigation, and free of flicker.

If used:
- source image to destination frame
- 250–300 ms
- minimal radius interpolation
- no dramatic zoom

Fallback: normal screen transition + image fade-in.

## Sending image question
1. image + prompt card appears in chat immediately
2. composer attachment clears after message ownership is established
3. image inference state begins
4. assistant response enters normally

Do not animate the same image twice.

# 14. History
## Enter History
History is a forward destination:
- native or right-to-left destination transition
- 250–300 ms

Do not present History as a modal fade.

## Row press
- scale 1 → 0.99
- subtle tone change
- 100 ms

## Search activation
- header controls crossfade into search field
- optional small position/width transition
- 200–250 ms

Do not animate every result row on each keystroke.

For no-result state:
- empty state fades in over 150–200 ms
- results return without row stagger

# 15. Local Status
The `Local Active` pill is static in steady state.

When status changes:
- crossfade icon/text
- 150 ms

Examples:
- `Local Active`
- `Loading Model`
- `Model Unavailable`

Do not continuously pulse the status dot.

# 16. Haptics
Use sparingly.

Recommended:
- model setup success → light success haptic
- destructive confirmation → warning haptic
- failed action needing attention → light error haptic

Do not add haptics to every button, streamed token, progress update, scroll, or navigation action. Respect device settings.

# 17. Reduced Motion
When reduced motion is enabled:
- replace nonessential translation with short fades
- remove spring overshoot
- remove content stagger
- disable shared-element zoom
- keep drawer gesture tracking direct
- reduce repeated vertical dot movement
- keep progress and loading states understandable

Recommended reduced-motion fade: 100–150 ms.

# 18. Forbidden Patterns
Do not add:
- WebGL shaders
- animated backgrounds
- floating particles
- glowing AI orbs
- repeated shield pulse
- body-text shimmer
- progress-bar shimmer
- full-screen shake
- bouncing buttons
- 600 ms ordinary screen crossfades
- per-token animation
- spring on every message
- staggered restored-history messages
- looping `Local Active` pulse
- fake progress
- fake verification countdown
- forced auto-scroll after the user scrolls away
- animation that delays controls
- JS animation loops during inference

# 19. React Native Motion Guardrails
Create centralized motion configuration, for example:
```text
src/
  design/
    motion.ts
```

Export:
- durations
- easings
- spring configs
- reduced-motion behavior

Animation ownership stays local to the component whose state changes:
- drawer owns position and scrim
- download card owns progress interpolation
- composer owns focus/height/disabled transitions
- attachment preview owns attachment enter/exit
- navigation owns screen transitions

Avoid one global animation controller for unrelated UI.

# 20. Default Constants
```text
PRESS_DURATION = 100ms
MICRO_DURATION = 150ms
QUICK_DURATION = 200ms
STANDARD_DURATION = 250ms
NAVIGATION_DURATION = 300ms
EMPHASIS_DURATION = 400ms

ROW_STAGGER = 45ms

MESSAGE_ENTRY_OFFSET_Y = 6dp
CONTENT_ENTRY_OFFSET_Y = 8dp
SCREEN_ENTRY_OFFSET_X = 20dp

BUTTON_PRESSED_SCALE = 0.985
ICON_PRESSED_SCALE = 0.94
CARD_PRESSED_SCALE = 0.99

DRAWER_SCRIM_OPACITY = 0.38
```

These are defaults, not a requirement to animate every component.

# 21. Critical Guardrails for Future Spec Kit Work
1. Use existing motion tokens.
2. Do not redesign existing transitions during unrelated feature work.
3. Motion must reflect actual application state.
4. Animation must never delay access to a control.
5. Local inference performance has priority over decorative motion.
6. Respect reduced-motion preferences.
7. Shared-image transitions are optional enhancement work, not a dependency.
8. Streaming must remain visually stable.
9. Drawer interaction should be gesture-driven when implemented.
10. Download progress must resume from current/persisted state instead of replaying.
11. Motion must never expose hidden inference stages or prompts.
12. Prefer fast feedback and calm settling over long transitions.

## Final Direction
> Fast feedback, calm transitions, no decorative AI spectacle.

The most important motion moments are:
- real model-download progress
- drawer following the user's gesture
- immediate message delivery
- clean generation-state transition
- stable streaming output
- simple setup completion

Everything else remains subtle.
