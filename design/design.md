# Locra Design Specification
**Status:** Finalized UI direction  
**Platform:** Android-first React Native  
**Use with:** `motion.md`, `screen_map.md`, and `design/references/`

## 1. Purpose
This file is the visual and interaction source of truth for Locra. Use it for future Spec Kit specifications, plans, tasks, and implementation work.

It defines:
- visual language and tokens
- global layout and navigation
- screen requirements
- reusable components
- responsive and accessibility rules
- critical UI guardrails

Functional architecture, model internals, persistence, inference orchestration, and download implementation belong in feature specifications unless UI behavior depends on them.

The reference screenshots define the intended hierarchy, spacing, proportions, and tone.

### Ignore screenshot/editor artifacts
Do not implement:
- purple selection borders
- design-tool title bars
- star/thumb rating controls
- dotted editor canvas backgrounds

## 2. Product Experience
Locra is a private, local-first AI assistant. The interface should communicate:
- AI works on the device
- the core experience can work offline after setup
- conversations and images stay local
- model-download requirements are clear before download
- image understanding is a first-class capability
- conversations are easy to resume
- technical complexity stays hidden unless useful

The product should feel calm, capable, warm, minimal, and trustworthy. Avoid making it look like a developer tool, model playground, benchmark app, or neon AI interface.

## 3. Design Principles
### 3.1 One dominant action per state
Each major state has one obvious primary action:
- Welcome → `Continue`
- Privacy → `Continue`
- Model setup → `Download model`
- Notification rationale → `Allow notifications`
- Success → `Start chatting`
- Storage error → `Retry`

Secondary actions remain quieter.

### 3.2 Progressive disclosure
Setup explains:
1. what Locra is
2. why local AI matters
3. why a model download is required
4. why notifications are useful
5. download progress
6. setup completion

Do not combine all technical details and permissions on one screen.

### 3.3 Local-first trust is visible but restrained
Use lightweight cues such as:
- `Even offline.`
- `Stay on your device`
- `Local Active`
- local-processing subtitles
- local-hardware footer copy

Do not repeat long privacy explanations everywhere.

### 3.4 Camera and chat are peers
Image input must remain easy to discover from the main composer. Image conversations stay inside the same overall chat system as text conversations.

### 3.5 Quiet visual hierarchy
Use dark forest green for:
- primary actions
- active states
- user message bubbles
- progress fill
- selected conversation rows
- local status indicators

Avoid decorative gradients, neon effects, strong shadows, and unnecessary color.

## 4. Design Tokens
### 4.1 Colors
| Token | Value | Usage |
|---|---:|---|
| `color.canvas` | `#FBF9F6` | Main warm background |
| `color.surface` | `#F5F3F1` | Secondary cards and assistant surfaces |
| `color.surfaceStrong` | `#FFFFFF` | Elevated cards and history rows |
| `color.primary` | `#334537` | Primary CTA, send, selected controls |
| `color.primarySoft` | `#4A5D4E` | User message bubble |
| `color.textPrimary` | `#202124` | Main text |
| `color.textSecondary` | `#5E5E5C` | Supporting text |
| `color.border` | `#C3C8C1` | Card and input borders |
| `color.divider` | `#E4E2E0` | Dividers |
| `color.errorSurface` | `#FFDAD6` | Error icon background |
| `color.error` | `#9B131B` | Error emphasis |
| `color.onPrimary` | `#FFFFFF` | Text/icons on primary |
| `color.onUserBubble` | `#F7F7F3` | User bubble text |

Purple visible around references is not a Locra color.

### 4.2 Typography
Use one sans-serif family throughout.

**Primary:** Inter  
**Fallback:** platform system sans-serif

| Role | Size | Weight | Line Height |
|---|---:|---:|---:|
| Hero title | 34 | 700 | 39 |
| Screen title | 28 | 700 | 33 |
| Section title | 20 | 600 | 26 |
| Card title | 16 | 600 | 22 |
| Body | 15 | 400 | 22 |
| Body strong | 15 | 600 | 22 |
| Supporting | 13 | 400 | 18 |
| Caption | 11 | 400/500 | 15 |
| Button | 14 | 500/600 | 18 |

Rules:
- allow natural wrapping
- never shrink text just to match screenshot line breaks
- keep long AI responses readable
- use bold selectively

### 4.3 Spacing
Use an 8-point system with half steps where needed:
- `4` micro gap
- `8` related inline spacing
- `12` compact spacing
- `16` default card padding
- `20` standard horizontal page padding
- `24` section spacing
- `32` major content spacing
- `40+` onboarding hero separation

### 4.4 Radius
| Element | Radius |
|---|---:|
| Pill/chip | full pill |
| Primary button | 18–24 |
| Standard card | 8–10 |
| Suggestion card | 8–10 |
| Message bubble | 8–10 |
| Composer | 12–16 |
| Circular icon action | fully circular |

### 4.5 Borders and elevation
- default border: 1 dp
- prefer border + surface contrast over strong shadow
- use subtle elevation only for hierarchy
- notification preview and download card may use light elevation
- avoid large blurred shadows

## 5. Global Layout
### 5.1 Viewport behavior
Target Android portrait layouts around 360–390 dp width while supporting smaller and taller devices.

Use:
- safe-area-aware padding
- 20–24 dp horizontal page padding
- scroll containers when vertical content exceeds the viewport
- keyboard-aware composer positioning
- content max widths on larger devices

### 5.2 Standard app header
The main chat header contains:
- left: hamburger/menu
- center: `Locra`
- right: settings

Rules:
- warm canvas background
- light visual weight
- subtle divider where useful
- fixed while chat content scrolls

### 5.3 Chat composer
The persistent composer contains:
- expanding text input
- contextual media control
- microphone where supported
- circular send action

Rules:
- minimum touch target: 44 × 44 dp
- dark-green send action when actionable
- clear disabled state
- composer stays above keyboard
- long text expands to a controlled maximum height
- preserve unsent draft text when sending is temporarily disabled

## 6. Navigation
Main destinations:
- New Chat
- Active Chat
- Image Chat
- Conversation Drawer
- Full History
- Settings

Behavior:
- hamburger opens the conversation drawer
- `New chat` starts a clean conversation
- selecting a conversation resumes it
- `View all history` opens History
- settings is reachable from header and drawer
- back from History returns to the previous app state
- image conversations remain part of the same chat system

The active conversation must be visually identifiable in the drawer. Detailed route/state flow belongs in `screen_map.md`.

# 7. Screen Specifications
## 7.1 Welcome
**Purpose:** Introduce the main value proposition immediately.

**Layout**
- full-screen dark charcoal/green background
- large quiet upper area
- centered copy in lower half
- primary action near bottom

**Title**
> AI that stays  
> with you.  
> Even offline.

**Supporting copy**
> Chat, understand images, and get help entirely on your device.

**Primary action:** `Continue`

**Rules**
- white, bold, centered hero title
- supporting text is lower contrast
- wide forest-green pill CTA
- no extra illustration unless separately approved
- the open upper area is intentional

## 7.2 Privacy
**Purpose:** Explain local-first value in plain language.

**Structure**
1. privacy/shield icon
2. centered title
3. three benefit rows
4. primary action

**Title**
> Intelligence  
> that respects  
> your privacy.

**Benefit rows**
- **Works without internet** — No connection required for core AI tasks.
- **Stay on your device** — Conversations and images never leave your hardware.
- **Fast local responses** — No network latency, just local assistance.

**Rules**
- warm ivory canvas
- small pale-green icon circles
- generous vertical spacing
- narrow readable copy width
- `Continue` is the only dominant action

## 7.3 Model Download Introduction
**Purpose:** Explain the one-time model setup requirement.

**Structure**
1. download icon card
2. title
3. short explanation
4. model metadata card
5. primary CTA
6. secondary action

**Title:** `Your AI lives on your device`

**Metadata card**
- Model
- Download Size
- Storage Required
- Wi-Fi recommendation

**Dynamic metadata rule:** Model name, quantization, size, and storage requirement come from actual model configuration. Reference values are examples, not hardcoded requirements.

**Actions**
- `Download model →`
- `Not now`

`Not now` must not mark the model as ready. Later inference without a verified model must route into setup/recovery.

## 7.4 Notification Permission Rationale
**Purpose:** Explain notification value before triggering Android permission.

**Structure**
1. notification preview card
2. title
3. body
4. `Allow notifications`
5. `Not now`

**Notification preview**
- Locra identity
- `Downloading Local AI Model…`
- progress bar
- percentage and estimated time
- compact status/download icon

**Behavior**
- do not request OS permission on screen mount
- request permission only after `Allow notifications`
- `Not now` must not block download

## 7.5 Download Progress
**Purpose:** Show honest download and verification progress.

**Structure**
1. download icon
2. title
3. model chip
4. progress card
5. supporting note
6. cancel action

**Title:** `Downloading Intelligence…`

**Progress card**
- percentage
- downloaded / total size
- progress bar
- current phase

Supported presentation states:
- preparing
- downloading
- reconnecting
- verifying
- complete
- failed

Progress must reflect real state. The user may leave the app while download continues. `Cancel` should confirm if substantial progress may be lost; recovery details belong in the feature specification.

## 7.6 Success
**Purpose:** Confirm local AI setup is complete.

**Content**
- Title: `Locra is ready.`
- Supporting: `Your AI now runs on this device.`
- CTA: `Start chatting →`

**Rules**
- sparse layout
- green success icon
- no extra feature cards
- no technical setup details
- show only after model verification succeeds

## 7.7 Insufficient Storage
**Purpose:** Provide a direct recovery path.

**Structure**
1. soft red error icon
2. title
3. explanation
4. primary recovery action
5. secondary storage action

**Title:** `Insufficient Storage`

Required free-space amount must be dynamic.

**Actions**
- `Retry`
- `Manage Storage`

**Rules**
- reserve red for error emphasis only
- keep primary recovery action green
- secondary action uses lower emphasis
- do not strand the user

## 7.8 New Chat
**Purpose:** Provide a simple entry into text, voice, and image help.

**Header**
- hamburger
- `Locra`
- settings

**Main content**
- Title: `What's on your mind?`
- Supporting: `Processing locally on your device for absolute privacy.`
- small shield/privacy icon

**Suggestion cards**
1. `Draft an email`
2. `Identify something in a photo`
3. `Explain a complex concept`

Each card has:
- leading icon
- label
- neutral surface
- subtle border
- full-row touch target

The photo suggestion should enter image selection/capture rather than send literal suggestion text as a normal prompt.

**Composer**
- Placeholder: `Ask anything…`
- Controls: image/media, microphone, send

### Attachment Source Selection

When the user taps the image/media action in the composer, Locra presents a simple source choice:

- Camera
- Gallery
- Cancel

Camera opens the existing camera capture experience.

Gallery opens the device image picker.

After capture or selection, the image returns to the draft belonging to the conversation that initiated the attachment flow. Navigation or conversation switching must not cause the selected image to attach to another conversation.

For Feature 003, one image may be attached per user turn. Image-bearing turns may occur anywhere in a conversation.

**Footer**
> Locra can make mistakes. Consider verifying important information.

## 7.9 Generating / Streaming Chat
**Purpose:** Show active local generation without disrupting the conversation.

**Status area may include**
- `Local Active` pill
- presentation-friendly dynamic model label

**User messages**
- right aligned
- muted dark-green bubble
- light text

**Assistant messages**
- left aligned
- light neutral/white surface
- readable long-form content

**Streaming requirements**
- no raw token artifacts
- no whole-message flicker
- no hidden prompt or perception output
- preserve scroll position if the user scrolls away
- auto-follow only while near bottom
- prevent duplicate sends during single-flight inference

## 7.10 Conversation Drawer
**Purpose:** Provide fast navigation between recent conversations.

**Presentation**
- left-side drawer
- warm ivory surface
- subtle dimmed scrim over remaining screen

**Header**
- `Locra`
- close action

**Primary action:** `+ New chat`

**Groups**
- `Today`
- `Yesterday`
- `Previous`

The active conversation uses a filled green row.

**Footer**
- `View all history`
- `Settings`

**Behavior**
- list scrolls when needed
- footer remains reachable
- selecting a conversation closes drawer and resumes that thread
- New Chat creates a clean conversation context

## 7.11 Image Preview / Image Ready
**Purpose:** Show that an image is attached and invite a focused question.

**Header:** Standard Locra header.

**Assistant prompt**
> Hello. I am ready to analyze the image you selected. What specific details would you like me to focus on?

Use:
- assistant/vision icon
- light neutral message surface
- compact padding

**Attachment**
- image thumbnail
- red circular remove control overlapping a corner

Removing the attachment must not remove the conversation.

**Composer**
- Placeholder: `Analyze this image…`
- image/media action
- send

The attachment remains associated with the next prompt until sent or removed.

## 7.12 Image Answer
**Purpose:** Present the image question and multimodal answer in one continuous thread.

**User image prompt card**
- image preview
- question below image
- low-emphasis metadata below

**Assistant identity**
- local vision/model icon
- presentation label such as `Locra Vision Model`

Avoid raw backend model identifiers.

**Answer content supports**
- paragraphs
- headings
- bold
- bullet lists
- numbered lists

**Composer:** `Ask a follow-up question…`

The follow-up remains in the same conversation. Hidden inference traces must never appear in visible history.

## 7.13 Active Text Chat
**Purpose:** Support longer conversations while preserving readability.

**Layout**
- fixed header
- scrollable conversation
- keyboard-aware composer
- optional low-emphasis local-processing footer

**Rich response support**
- paragraphs
- bullets
- bold
- inline technical terms
- quote/callout blocks

**Quote/callout**
- neutral surface
- dark-green left rule
- italic content where appropriate
- comfortable padding

**Composer:** `Message Locra…`

Design must not imply network access or external tools unless a functional specification explicitly adds that behavior.

**Footer example**
> Locra operates entirely on your local hardware. No data leaves this device.

Keep it small and low contrast.

## 7.14 Full History
**Purpose:** Provide a searchable view of locally stored conversations.

**Header**
- back
- centered `History`
- search

**Sections**
- `TODAY`
- `YESTERDAY`
- `PREVIOUS 7 DAYS`
-  `OLDER`

All stored conversations must remain reachable from History. Conversations older than seven days must not disappear from the History experience.

**Conversation row**
- leading contextual icon
- title
- time/date
- short preview snippet

**Style**
- white surface
- thin border
- small radius
- compact spacing

**Behavior**
- search filters locally according to feature implementation
- selecting a card resumes the conversation
- long titles and previews truncate cleanly
- time grouping follows device locale/time behavior

# 8. Reusable Components
## Navigation
- `AppHeader`
- `BackHeader`
- `ConversationDrawer`
- `HistorySection`

## Buttons
- `PrimaryButton`
- `SecondaryTextButton`
- `OutlineButton`
- `CircularIconButton`

## Chat
- `ChatComposer`
- `AssistantMessage`
- `UserMessage`
- `ImagePromptCard`
- `AssistantIdentityRow`
- `QuoteCallout`
- `StreamingMessage`
- `LocalStatusPill`

## Onboarding
- `OnboardingLayout`
- `FeatureValueRow`
- `ModelMetadataCard`
- `NotificationPreviewCard`
- `DownloadProgressCard`
- `SetupStateIcon`

## Cards and rows
- `SuggestionCard`
- `ConversationListItem`
- `HistoryCard`
- `ModelChip`

# 9. Required Component States
## Buttons
- default
- pressed
- disabled
- loading where appropriate

## Composer
- empty
- text entered
- image attached
- voice available
- generating/locked
- retry/error if send fails

## Download progress
- preparing
- downloading
- reconnecting
- verifying
- failed
- complete

Keep the card layout stable across phases.

## Conversation row
- default
- pressed
- selected/current

Do not invent unread badges in the current design.

# 10. Responsive Behavior
## Narrow devices
- reduce horizontal margins before reducing type size
- allow titles to wrap
- keep metadata readable
- preserve full-width primary actions
- keep suggestion labels readable

## Short-height devices
- onboarding becomes scrollable
- error actions remain reachable
- download progress card stays intact
- composer remains usable above keyboard

## Larger devices
- use max widths for copy and cards
- do not stretch body text across the full screen
- prevent chat bubbles from becoming excessively wide

# 11. Accessibility
Minimum requirements:
- 44 × 44 dp touch targets
- labels for icon-only controls
- semantic progress announcements
- text labels for download phases
- errors use icon + title + message, not color alone
- sufficient contrast
- logical screen-reader order
- support large text without clipping controls
- small-screen onboarding and error states remain scrollable
- composer remains reachable with keyboard and font scaling
- attachment remove action has a clear accessibility label
- history timestamps read in meaningful order

# 12. Content Rules
Locra copy should be:
- direct
- calm
- short
- plain-language
- confident without overclaiming

Prefer:
- `Works without internet`
- `Stay on your device`
- `Your AI now runs on this device`

Avoid:
- unexplained inference jargon
- benchmark claims in normal UI
- exaggerated security language
- overly playful chatbot copy
- internal model filenames
- prompt-stage labels

### Model naming
Use friendly presentation names when useful:
- `Locra Vision Model`
- configured model display name

Do not show raw file names, hashes, internal IDs, or prompt-stage names.

# 13. User-Visible vs Internal AI State
Visible conversation may contain:
- user text
- user image attachment
- assistant response
- follow-up messages
- formatted answer content

Internal-only information must never be shown in:
- chat
- drawer previews
- History
- resumed conversations
- exports/shares unless intentionally transformed into visible answer content

Internal-only examples:
- perception prompts
- extraction prompts
- system instructions
- intermediate visual evidence
- parser diagnostics
- timing traces
- duplicated reconstructed transcripts

# 14. Loading and Failure Coverage
Every asynchronous flow needs an explicit UI state.

**Model setup**
- checking storage
- preparing
- downloading
- reconnecting
- verifying
- ready
- failed
- insufficient storage

**Inference**
- idle
- preparing image
- generating
- streaming
- complete
- failed with retry path

**History**
- empty history
- loading
- search with no results

Missing states should extend the existing visual system rather than create new styling.

# 15. React Native UI Guardrails
- use centralized theme tokens
- reuse shared primitives for cards, buttons, headers, and bubbles
- keep composer keyboard-aware
- use virtualized lists for long chat/history lists where appropriate
- preserve stable message keys during streaming
- avoid re-rendering the full conversation per token update
- render rich AI output through controlled components
- do not render arbitrary model-generated HTML
- preserve image aspect ratio
- do not center-crop document-like images by default
- bind model metadata to real configuration/state
- show notification rationale before OS permission prompt
- do not show success before model verification completes

# 16. Critical Guardrails for Future Spec Kit Work
1. Treat this file and approved references as the visual source of truth.
2. Use `screen_map.md` for route/state flow instead of duplicating navigation maps here.
3. Use `motion.md` for transition timing and animation behavior.
4. Do not redesign existing screens during unrelated feature work.
5. New screens must reuse the same tokens and component language.
6. Keep model metadata dynamic.
7. Never expose hidden inference stages in visible conversation UI.
8. Do not add model selectors, agents, RAG controls, benchmark panels, or developer diagnostics unless explicitly specified later.
9. Keep the primary experience centered on private local chat, image understanding, and reliable offline use.
10. Preserve clear recovery paths for model setup and inference failures.
