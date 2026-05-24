# performer - Architecture & Context for Claude

## Project Overview

Real-time WebGL video effects application with MIDI controller integration. Used in live music performance. Users apply shader effects to webcam or video files, control effects via MIDI (Launchkey Mini MK3), and synchronize effects with BPM.

## Tech Stack

- **Framework**: Vue 3 + TypeScript (Composition API)
- **Build Tool**: Vite 8
- **Package Manager**: Yarn (NOT npm)
- **Testing**: Vitest 4 + @vue/test-utils
- **Styling**: Plain CSS
- **APIs**: WebGL, WebMIDI, MediaStream
- **License**: GPL-3.0-or-later

## Architecture

### Composables-Based Architecture

App.vue coordinates 8 composables that separate concerns:

1. **useBpmTap** - BPM tap tempo calculation from spacebar
2. **useSettings** - Settings persistence to localStorage (showHelp, isMuted, inputSource, bpm)
3. **useEffectTransitions** - **CRITICAL**: Single source of truth for `activeEffects` state + smooth effect transitions
4. **useVideoPlaylist** - Video playlist management, playback controls
5. **useVideoSource** - Video element source management (webcam vs file)
6. **useMidi** - MIDI controller integration (Launchkey Mini MK3)
7. **useWebGLRenderer** - WebGL rendering pipeline (sets up once on mount, reads from reactive refs)
8. **usePopupWindow** - Popup window via createApp() in a second window

### Key State Management Rules

⚠️ **CRITICAL - State Synchronization**:

- `activeEffects` lives ONLY in `useEffectTransitions` - it's the single source of truth
- Never create duplicate `activeEffects` state elsewhere
- All state is `Ref<T>` - composables return refs directly, consumers read/write `.value`

❌ **NEVER DO THIS**:

```typescript
// BAD - causes circular reactivity
watch(settings.activeEffects, (val) => {
  effectTransitions.activeEffects.value = val;
});
```

### Shader Effects System

**Effects Enum** (src/utils.ts):

```typescript
enum ShaderEffect {
  INVERT,
  GRAYSCALE,
  REALITY_GLITCH,
  KALEIDOSCOPE,
  DISPLACE,
  SWIRL,
  CHROMA,
  PIXELATE,
  VORONOI,
  RIPPLE,
  FEEDBACK_ECHO,
  PALETTE_CYCLING,
  CONTOUR
}
```

**Effect Stages**:

- `mapping` stage: Mutates UV coordinates (distortion effects)
- `color` stage: Mutates color values (color effects)
- `feedback` stage: Reads `u_history` texture (previous frame) — used by FEEDBACK_ECHO

**Intensity Control**: Some effects have `intensity` property (0-1 range)

**Transitions**: Effects smoothly fade in/out using `src/transitions.ts`

### Project Structure

```
src/
├── App.vue                          # Main app component
├── components/
│   ├── ControlPanel.vue             # Tab container (Input / Effects)
│   ├── EffectsTab.vue               # Effect toggles + intensity sliders
│   ├── InputTab.vue                 # Source select, playlist, timeline
│   └── index.ts                     # Component exports
├── composables/                     # Vue composables (= React hooks)
│   ├── useBpmTap.ts
│   ├── useSettings.ts
│   ├── useEffectTransitions.ts      # SINGLE SOURCE OF TRUTH for activeEffects
│   ├── useVideoPlaylist.ts
│   ├── useVideoSource.ts
│   ├── useMidi.ts
│   ├── useWebGLRenderer.ts
│   ├── usePopupWindow.ts
│   └── *.test.ts                    # Vitest tests (41 tests total)
├── services/
│   └── settingsService.ts           # localStorage (keys: performer-*)
├── transitions.ts                   # Effect transition system
├── shaderBuilder.ts                 # GLSL shader source builders
├── utils.ts                         # ShaderEffect enum + definitions
├── main.ts                          # createApp(App).mount('#app')
├── index.css
└── test/
    ├── setup.ts
    └── utils.ts                     # withSetup() helper for composable tests
```

### Testing

**Test Coverage** (41 tests):

- useBpmTap.test.ts - BPM calculation, spacebar events
- useSettings.test.ts - load/save lifecycle
- useEffectTransitions.test.ts - toggle, debounce, intensity
- useVideoPlaylist.test.ts - playlist management, playback

**withSetup() pattern** for composable tests:

```typescript
const [result, cleanup] = withSetup(() => useMyComposable());
result.someRef.value; // access
result.someRef.value = newVal; // mutate
await nextTick(); // wait for watchers
cleanup(); // unmount
```

**Run tests**: `yarn test`

### Settings Persistence

**settingsService** (src/services/settingsService.ts):

- Saves/loads to localStorage with key prefix `performer-`
- Settings: showHelp, isMuted, inputSource, bpm, activeEffects

### useWebGLRenderer — Key Architecture Note

In the Vue version, WebGL shaders are compiled **once on mount** for all effects. The render loop reads from reactive refs (`options.activeEffects.value`, `options.bpm.value`, etc.) directly on every frame — no rebuild needed when effects change. This is more efficient than the old React version.

## Development Workflow Rules

### CRITICAL RULES:

1. **NEVER modify logic without explicit permission**
2. **ALWAYS run tests before marking complete**: `yarn test --run`
3. **DO NOT be "smart" about architecture** — every part is deliberate

### Code Style

- Vue 3 Composition API only (`<script setup>`)
- Props via `defineProps`, emits via `defineEmits`
- Composables return reactive refs directly (no separate setters)
- TypeScript strict mode, no `any`
- No emojis in code (only in UI strings already present)

### Git Workflow

⚠️ **CRITICAL**: Never run git state-modifying commands unless explicitly asked.

## MIDI Integration

**Controller**: Novation Launchkey Mini MK3

**Mapping**:

- Top row pads (40-43, 48-51): toggle effects + knob control
- Bottom row pads (36-39, 44-47): toggle only
- Knobs 1-8 (CC 21-28): intensity for top-row effects

## GitHub Actions

- `ci.yml` — on PR to main: lint:ci, format:check, typecheck, test
- `auto-release.yml` — on merged PR with release:patch/minor/major label
- `build-and-release.yml` — on release tag: build + deploy to GitHub Pages

## Deployment

- Build: `yarn dist`
- Deploy: GitHub Actions on tag push → GitHub Pages at https://berrutti.github.io/performer

## Future Effects (Not Yet Built)

1. BLOOM — multi-pass: threshold → blur → composite
2. REACTION_DIFFUSION — Gray-Scott sim seeded by luminance
3. PIXEL_SORT — sort pixels by brightness, glitch aesthetic

## Contact

- Author: berrutti (berrutit@gmail.com)
- GitHub: https://github.com/berrutti
