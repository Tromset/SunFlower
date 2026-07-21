# Sunflower

Sunflower is a macOS screen companion that runs on **local models**. It lives in your menu bar, sees your screen, and answers out loud — and the model doing the thinking runs on your own machine through [Ollama](https://ollama.com). No model provider, no per-token bill, no screenshots leaving your Mac.

Sunflower started as a fork of [Glide](https://github.com/shujanshaikh/glide), which itself started as a clone of [Clicky](https://github.com/farzaa/clicky) by [Farza](https://x.com/FarzaTV). This version replaces the hosted-model backend with local inference.

## What it does

You hold a push-to-talk key and talk. Sunflower captures your screen, sends the image plus your transcript to a local vision model, streams the answer back, speaks it out loud, and can point at things on screen with an on-screen cursor. If you connect external apps through Composio, it can also take action in them.

The backend is a small Hono API running on a Cloudflare Worker. It handles:

- authenticated chat streaming against a **local Ollama** instance (native `/api/chat`)
- listing the models you have pulled locally, with their capabilities
- AssemblyAI realtime transcription token generation
- Gradium text-to-speech proxying
- Composio-powered integrations for connected apps (Notion, Google Docs, Gmail, Slack, GitHub, …)
- Clerk authentication for the macOS app and the server routes

### What runs locally, and what doesn't

Only the **language model** is local. Transcription (AssemblyAI), speech (Gradium), auth (Clerk) and app integrations (Composio) are still hosted services, and each is optional in the sense that the feature it powers simply won't work without its key.

> **Inherited telemetry:** the macOS app still contains the upstream project's analytics — `apps/macos/Glide/GlideAnalytics.swift` initialises PostHog with a hardcoded key on every launch (events include your messages and the AI's responses), and the onboarding flow in `CompanionManager.swift` sends the email you enter to the upstream author's form endpoint. If you don't want your usage reported to the upstream project's analytics, remove or gate those two call sites before building.

## Architecture

```txt
apps/
  electron/ Electron screen companion "sunflower" — fully local (Whisper + Ollama)
  macos/    Native Swift/AppKit menu bar app
  server/   Hono Cloudflare Worker API
packages/
  config/   Shared TypeScript config
```

The app owns the macOS experience: menu bar UI, push-to-talk, screen capture, voice playback, cursor pointing, auth callbacks. The Worker owns authenticated API access, model streaming, transcription tokens, TTS proxying, and tool integrations.

The app never picks a model — it sends messages and the server decides which Ollama model to use. That keeps model configuration in one place (`OLLAMA_MODEL`) and means you can change models without rebuilding the app.

> **Note on naming:** the Xcode project, scheme and target are still named `Glide`, and the app's URL scheme is still `glide://`. Renaming them is cosmetic and risks breaking the Clerk and Composio redirect flows, so it hasn't been done. Wherever this README says `Glide`, it means the Xcode target.

## Electron app — `sunflower` (100 % local)

`apps/electron` is a second, fully local implementation of the companion, built from the Claude Design prototype in `app-electron-avec-tournesol-local/`. Unlike the Swift app + Worker pair, it needs **no server, no Clerk, no API keys**: push-to-talk (hold ⌃ ⌥) → mic capture → **local Whisper** transcription (whisper.cpp, Metal) → screenshot → **local Ollama** vision model → streamed answer in a speech bubble next to a pixel-art sunflower that follows your cursor, spoken aloud with the macOS system voice. English UI, in the app's black-and-yellow theme.

Surfaces: a status island under the menu-bar notch, the cursor-following sunflower companion with its speech bubble, an orange pointing overlay (the model can highlight one on-screen element), a menu-bar tray panel (live permissions, model status, quit), and a 3-step onboarding on first launch.

### Screenshots

The onboarding walks through welcome, permissions, and the local-model check — in the same black-and-yellow theme as the running app:

| Welcome | Permissions | Local model |
| --- | --- | --- |
| ![Onboarding welcome step](apps/electron/docs/screenshots/onboarding-welcome.png) | ![Onboarding permissions step](apps/electron/docs/screenshots/onboarding-permissions.png) | ![Onboarding local-model step](apps/electron/docs/screenshots/onboarding-model.png) |

The menu-bar panel shows live permission, model, and voice status:

![Menu-bar panel](apps/electron/docs/screenshots/panel.png)

The status island sits under the notch while sunflower listens and answers, and the cursor-following companion streams the reply in a speech bubble:

| Listening | Answering | Companion |
| --- | --- | --- |
| ![Island listening state](apps/electron/docs/screenshots/island-listening.png) | ![Island answering state](apps/electron/docs/screenshots/island-answering.png) | ![Cursor companion with speech bubble](apps/electron/docs/screenshots/companion.png) |

### Run it

```bash
pnpm install        # once, at the repo root (builds whisper.cpp — needs Xcode CLT)
npm start           # at the repo root (or in apps/electron)
```

Or install the global command:

```bash
cd apps/electron
npm link
sunflower           # from anywhere
```

Requirements: [Ollama](https://ollama.com) running (`ollama serve`) with a **vision-capable** model pulled. The default is `qwen3-vl:8b`; if it's absent, sunflower automatically uses the first local model with the `vision` capability. The Whisper model (`ggml-small-q5_1`, ~190 MB) downloads once on first launch into `~/Library/Application Support/sunflower/models/`.

macOS permissions (requested during onboarding, all grants go to the Electron binary): microphone, accessibility (global ⌃ ⌥ hotkey), screen recording. Config lives in `~/Library/Application Support/sunflower/config.json` (`ollamaHost`, `ollamaModel`, `whisperModel`); `OLLAMA_HOST` env var overrides the host. Sunflower's own windows are excluded from its screenshots via content protection.

Screen recording has a macOS quirk: its Settings pane only lists an app *after* the app has attempted a capture (there is no "+" button). Sunflower's first "grant" click triggers that attempt so the app registers itself and the system prompt appears; a second click opens the now-populated Settings pane. In dev the entry is named **Electron** (grants go to the Electron binary). After you tick the box, macOS offers to "Quit & Reopen" — choose **Later** and rerun `npm start` yourself, because the auto-relaunch starts a bare Electron without sunflower's app path. The grant survives the relaunch.

### The terminal

When launched from a terminal (`npm start` or `sunflower`), sunflower turns it into a first-class interface:

- A startup banner shows the Ollama host and model, whisper status, and the hotkey — with the fix printed in red when something is missing (`ollama serve`, `ollama pull …`).
- **Type a question at the `❯` prompt** — it takes a screenshot at your cursor and runs the exact same pipeline as voice: the answer streams into the terminal *and* into the companion bubble with speech. Typing works even while whisper is still downloading.
- Voice sessions render live too: `listening…`, `looking at your screen…`, your transcribed question, a spinner while the model thinks, then the streamed answer with its duration.
- On a cold start the spinner says `waking the model…` instead of failing — sunflower preloads the model when the app launches and again the moment you start speaking, and allows up to ~3 minutes for the first token of a cold load.
- **Ctrl+C** interrupts the current answer; at an idle prompt it quits the app. Set `SUNFLOWER_DEBUG=1` for full error details.
- Without a TTY (packaged app, redirected output) all of this degrades to plain `[sunflower]` log lines — nothing else changes.

## Prerequisites

- macOS with Xcode installed
- Node.js and pnpm
- [Ollama](https://ollama.com) running locally
- A Clerk application (required — every API route is authenticated)
- Optional, per feature: AssemblyAI (transcription), Gradium (speech), Composio (app integrations)

## 1. Install Ollama and pull a model

```bash
brew install ollama
ollama serve
```

Or download the app from [ollama.com/download](https://ollama.com/download).

Then pull a model. Sunflower's default is `qwen3-vl:8b`:

```bash
ollama pull qwen3-vl:8b
```

**Pick a model with the right capabilities.** Sunflower sends screenshots, so you want a model with `vision`. If you plan to use the Composio integrations, you also need `tools`:

| Model | Vision | Tools | Notes |
| --- | --- | --- | --- |
| `qwen3-vl:8b` | ✅ | ✅ | Default. Good balance of quality and speed. |
| `qwen3-vl:32b` | ✅ | ✅ | Better answers, needs a lot more RAM. |
| `llama3.2-vision` | ✅ | ❌ | Vision only — no app integrations. |
| `gemma3` | ✅ | ❌ | Vision only — no app integrations. |
| `minicpm-v` | ✅ | ❌ | Small and fast, vision only. |

Check what a model actually supports:

```bash
ollama show qwen3-vl:8b
```

A model without `vision` will not be able to see your screen. A model without `tools` will ignore the connected-app integrations.

## 2. Install dependencies

```bash
pnpm install
```

## 3. Configure the Worker

Create `apps/server/.dev.vars`:

```bash
# Required — every route is behind Clerk
CLERK_SECRET_KEY=...
CLERK_PUBLISHABLE_KEY=...

# Optional, per feature
ASSEMBLYAI_API_KEY=...   # /transcribe-token
GRADIUM_API_KEY=...      # /tts
COMPOSIO_API_KEY=...     # app integrations

# Optional TTS tuning — defaults live in wrangler.toml
GRADIUM_TTS_MODEL=default
GRADIUM_TTS_VOICE_ID=...

# Ollama — defaults also live in wrangler.toml
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen3-vl:8b
OLLAMA_NUM_CTX=32768
```

The Ollama settings are plain vars, not secrets, so they are already in `apps/server/wrangler.toml` with the defaults above. Only override them in `.dev.vars` if you want different values locally.

### About `OLLAMA_NUM_CTX`

Ollama defaults to a 4096-token context window. A screenshot plus Sunflower's agent instructions blows straight through that, and the result is silent truncation — the model behaves as if it never saw part of your screen. Sunflower therefore always sends an explicit `num_ctx`, defaulting to 32768.

If you have limited RAM, lower it (`16384`). If you send large screenshots or hold long conversations, raise it — but the ceiling is whatever the model itself supports, and a larger window costs memory.

## 4. Run the Worker

```bash
pnpm run dev:server
```

It listens on `http://localhost:8787`.

## 5. Configure and run the macOS app

The app reads these values from Xcode build settings, injected into `apps/macos/Glide/Info.plist`:

```txt
GLIDE_SERVER_BASE_URL   # e.g. http://localhost:8787
CLERK_PUBLISHABLE_KEY   # must match the Clerk app the server uses
CLERK_CALLBACK_SCHEME   # usually glide
CLERK_REDIRECT_URL      # usually glide://callback
```

If `GLIDE_SERVER_BASE_URL` is unset, the app falls back to `http://localhost:8787`.

> **The project ships with the upstream author's values baked in.** `project.pbxproj` carries a `CLERK_PUBLISHABLE_KEY` for the upstream Clerk dev instance and the upstream `DEVELOPMENT_TEAM` ids. If you build without changing them, the app will authenticate against someone else's Clerk application and every server call will 401 (your server uses *your* Clerk secret). Replace `CLERK_PUBLISHABLE_KEY` in the `Glide` target's Build Settings (User-Defined section) with the publishable key from the same Clerk application as your `CLERK_SECRET_KEY`.

Then:

```bash
open apps/macos/Glide.xcodeproj
```

1. Select the `Glide` scheme.
2. Set your signing team under Signing & Capabilities.
3. Replace `CLERK_PUBLISHABLE_KEY` in Build Settings, as above.
4. Cmd + R.

Sunflower appears in the menu bar. Sign in, grant the screen-recording and microphone permissions it asks for, and hold your push-to-talk key.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/chat` | Streaming chat. Accepts an optional `model` to override `OLLAMA_MODEL` for that request. |
| `GET` | `/models` | Models pulled locally, with capabilities and the configured default. |
| `POST` | `/tts` | Gradium text-to-speech proxy. |
| `POST` | `/transcribe-token` | Short-lived AssemblyAI streaming token. |
| `POST` | `/integrations/statuses` | Which toolkits are connected. |
| `POST` | `/integrations/:toolkit/connect` | Create a Composio connection link. |
| `DELETE` | `/integrations/:toolkit/disconnect` | Remove connected accounts for a toolkit. |

All routes require a Clerk session token.

`GET /models` exists so a client can build a model picker without hardcoding a list. It returns the capability flags Ollama reports, so a UI can, for example, grey out models that can't see images:

```json
{
  "defaultModel": "qwen3-vl:8b",
  "models": [
    {
      "id": "qwen3-vl:8b",
      "name": "qwen3-vl:8b",
      "family": "qwen3vl",
      "parameterSize": "…",
      "quantization": "…",
      "contextLength": 0,
      "sizeBytes": 0,
      "capabilities": { "completion": true, "vision": true, "tools": true, "thinking": true }
    }
  ]
}
```

(`parameterSize`, `quantization`, `contextLength` and `sizeBytes` are whatever your Ollama reports for the models you actually have.)

It returns `503` if Ollama isn't reachable and `502` if Ollama answers with an error. Note it sits behind Clerk like every other route — for an unauthenticated setup-time check, ask Ollama directly: `curl http://localhost:11434/api/tags`.

## App integrations with Composio

The server uses `@composio/core` with the Composio Vercel provider. When a signed-in user asks for something that involves an external app, the server looks up that user's connected accounts and loads the relevant toolkit tools into the `streamText` call. Tools are only loaded when the request actually calls for external-app work.

Composio OAuth returns to the app via:

```txt
glide://composio/callback
```

Allow that redirect URL wherever your Composio setup requires it.

Remember that this path needs a model with `tools` support. With a vision-only model, chat and screen understanding work fine and integrations are simply ignored.

## Deployment

Sunflower is built around a local Ollama, and `localhost` means something different inside a deployed Cloudflare Worker than it does on your Mac. Two options:

**Run the Worker locally (recommended).** `pnpm run dev:server` on the same machine as Ollama. Everything stays on your Mac.

**Deploy the Worker and expose Ollama.** Point `OLLAMA_HOST` at an Ollama instance the Worker can reach over the network — a tunnel, or a machine you control:

```bash
pnpm run deploy:server
cd apps/server
npx wrangler secret put CLERK_SECRET_KEY
npx wrangler secret put CLERK_PUBLISHABLE_KEY
npx wrangler secret put ASSEMBLYAI_API_KEY
npx wrangler secret put GRADIUM_API_KEY
npx wrangler secret put COMPOSIO_API_KEY
```

Set `OLLAMA_HOST` in `wrangler.toml` under `[vars]`. (If you'd rather store it as a secret because the URL is sensitive, you must also **delete** the `OLLAMA_HOST` line from `[vars]` — a plain var with the same name overrides the secret on every deploy.)

If you do this, **put authentication in front of Ollama.** The Ollama API has no auth of its own — anything that can reach it can use your GPU and read your prompts. Never expose port `11434` directly to the internet.

## Scripts

- `pnpm run dev` — start all configured apps
- `pnpm run dev:server` — start the Worker locally
- `pnpm run check-types` — TypeScript checks
- `pnpm run deploy:server` — deploy the Worker

## Troubleshooting

**Answers ignore what's on screen.** The model probably has no `vision` capability — check `ollama show <model>`. If it does, `OLLAMA_NUM_CTX` may be too small for the screenshot.

**Integrations never fire.** The model has no `tools` capability. `ollama show <model>` will tell you.

**First reply is very slow.** Ollama loads the model into memory on first use. The Electron app now preloads it at launch and when you start speaking, shows `waking the model…` while it loads, and waits up to ~3 minutes for a cold first token (45 s once warm). If it still times out — `the model is still loading` — warm it manually with `ollama run <model>` or switch to a smaller vision model such as `minicpm-v`.

**The app connects but answers come back empty.** This is almost always Ollama-side: the configured model isn't pulled, or Ollama isn't running. `/chat` still responds HTTP 200 in that case — the error travels *inside* the stream as an `error` event, which the app currently doesn't display. Check the Worker logs (`pnpm run dev:server` prints the Ollama error, e.g. `model 'qwen3-vl:8b' not found`), confirm Ollama is up (`curl http://localhost:11434/api/tags`), and confirm `OLLAMA_MODEL` names a model you have actually pulled — Ollama does not pull on demand.

**Everything returns 401.** Clerk keys in `.dev.vars` and in the Xcode build settings must come from the same Clerk application.

## License

MIT — see [LICENSE](LICENSE).
