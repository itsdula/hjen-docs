# `hjen-app` — the desktop studio

This is **the product**: a macOS desktop application (`HJEN Studio`, app id `ai.hjen.studio`) that artists actually run. Everything else in the system exists to support it.

- **Version:** `0.11.0-rc.1` (from `package.json`)
- **Type:** Electron desktop app, packaged with `electron-builder` into a signed & notarized `.dmg` / `.zip`
- **Role:** Frontend / client

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 32 |
| UI | React 18 + TypeScript + Vite 5 |
| State | Zustand |
| Direct AI SDK | `openai` (used when the app talks to providers directly) |
| Auto-update | `electron-updater` |
| Local ML sidecars | Python (`worldkit/`: depth, pose, segmentation, cut detection) |
| Bundled binaries | `ffmpeg`, `yt-dlp` (shipped inside the `.app`) |

The renderer (`src/`) is a standard React/Vite app. The heavy lifting lives in the **Electron main process** (`electron/main.ts`), which is a single ~9,700-line file exposing roughly **277 IPC handlers** — the largest and most important file in the whole system. The product surfaces about **31 tools** (from the `ProductHub` registry).

## Directory layout

| Path | What's in it |
|---|---|
| `electron/` | Main process (`main.ts`), preload bridge (`preload.ts`), and per-tool engines (`swap.ts`, `clipper.ts`, `contextAgents.ts`, `eye.ts`, `idea.ts`, `breakdownPdf.ts`, `ffmpegGraph.ts`, `fcpxml.ts`, `syncEngine.ts`, `providerFallback.ts`, `tools.ts`) |
| `src/` | React renderer — `App.tsx`, `components/`, `lib/`, `store/`, `styles/`, `types/` |
| `worldkit/` | Python ML sidecars for the 3D / depth / pose tools |
| `skills/` | Anthropic-style markdown "skill" files the studio can run |
| `public/` | Static catalog data (cameras, lenses, film stocks, lighting, movements) and thumbnails |
| `build/` | Packaging scripts, app icon, macOS entitlements, `release.sh` |
| `diagrams/` | Architecture diagrams |
| `electron/` extras | `gen_pattren.js`, `mannequin.js` (Film Space helpers) live at repo root |

## The tools it provides

The app is a suite of job-specific creative tools. Reading the preload bridge (`electron/preload.ts`) — which is the complete list of everything the UI can ask the main process to do — the tools include:

- **Frame** — still-image generation from director-language selections + reference layers.
- **Storyboard** — script → panels, with cast cards and continuity; PDF export.
- **Assets** — character / location / prop / wardrobe plate factories.
- **Videos** — Seedance 2.0 (BytePlus) and Kling submit/poll pipelines; failed-video recovery.
- **Breakdown** — video ingest, dense-frame extraction, ASR transcription, per-shot analysis, PDF export ("Ad Breakdown 360").
- **The Eye** — reads an image on ten axes; ranks candidates by feel.
- **The Swap** — slot/consequence/plan/compose/verify pipeline to change one element of an image.
- **Reference Maker / Reference Scene** — understand a reference and re-derive a contract from it.
- **Context Agents** — a DNA-agnostic creative engine (recipe kept in the main process).
- **Creative Mind** — a Zettelkasten-style brainstorming canvas.
- **Film Space / HJEN SET** — a 3D stage with a mannequin, depth-world building, and "Angle Pack" export; single-image body recovery (HMR/SMPL) via a Python sidecar.
- **Emulsion** — offline camera-body × lens × film-stock emulation, including video.
- **Node canvas** — wire tools into repeatable graphs.
- **Cuts** — internal shot-boundary + representative-frame extractor.
- **HJEN Clipper** — a browser extension bridge that clips web frames into the studio.
- **IDEA** — a Saudi Ad Voice agent graph for scriptwriting.
- **Mood Board / Timeline** — detachable panel documents.

## How it connects to the rest of the system

### Two ways to get AI results

1. **Direct mode** — the app calls providers itself using the user's own API keys (OpenAI, Google, Anthropic, Replicate, BytePlus/ARK, Kling). Keys are entered in Settings.
2. **Gateway mode** — the app is pointed at `hjen-server` via a saved "gateway" config (`{userData}/gateway.json`) holding a `url` and an invite `token`. In this mode the OpenAI SDK's `baseURL` is set to `…/v1/openai` and the invite token is sent as the bearer; the server swaps in the real key, meters the make, and can save the result to per-account cloud storage. This is the commercial path.

The gateway setting is mirrored into the renderer's `localStorage` (`hjen.gateway.baseURL`, `hjen.gateway.token`) on load, so the renderer-side doors use the same source as the main-process doors.

### Auto-update → `hjen-releases`

`package.json`'s `build.publish` points at the GitHub repo `hjen-studio/hjen-releases`. On launch (packaged builds only) `electron-updater` checks that feed, downloads any newer version in the background, and installs on quit or when the user clicks "Restart to update."

### MCP bridge → `hjen-mcp`

The app runs a **local control port** (an HTTP server on `127.0.0.1`, random port, written to `{userData}/mcp-control.json`) and registers the `hjen-studio://` deep-link protocol. This lets `hjen-mcp` drive real app actions (navigate, reload, run a command) and hot-reload a document the agent just wrote. The in-app "Assistant" panel also uses these bridges.

## How API keys are stored

When the user chooses direct mode, keys are written as **plaintext files** in Electron's `userData` directory with permissions `0600`:

- `openai_key.txt`, `google_key.txt`, `anthropic_key.txt`, `replicate_key.txt`, `ark_key.txt`, `kling_key.txt`

They are **not** encrypted with Electron's `safeStorage` / the OS keychain. See the security review for why that matters and the trade-off involved.

## Electron security posture (summary)

The app gets the important defaults right and has a few sharp edges:

- **Good:** `nodeIntegration: false` and `contextIsolation: true` on every `BrowserWindow`; a typed `contextBridge` preload; child processes are spawned with argument arrays (not a shell), so classic command injection is largely avoided.
- **Sharp edges:** a custom `hjen-file://` protocol serves **any absolute path on disk** with `Access-Control-Allow-Origin: *` (no directory confinement); several IPCs read **any local file** or **fetch any URL** through the privileged main process; Chrome remote-debugging is launched on port `9333` with `--remote-allow-origins=*`; the local control port accepts commands with **no auth token**; and API keys are stored in plaintext. On their own these are conveniences, but together they turn a single renderer XSS into arbitrary file read + exfiltration. All are detailed with file/line references in the [security review](#22-security).

## Build & run

```bash
npm install
npm run dev            # Vite + Electron in development
npm run build          # tsc + vite build + electron-builder (packaged app)
npm run release        # build/release.sh — signs, notarizes, publishes to hjen-releases
```
