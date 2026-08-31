# Glossary of HJEN codenames

HJEN's code uses a lot of evocative internal names for its tools and concepts. This is a plain-language decoder, drawn from the desktop app's preload bridge (`hjen-app/electron/preload.ts`) and the server's endpoints.

## The creative tools

| Name | What it is |
|---|---|
| **Frame** | The core still-image maker. You pick "director language" (camera, lens, film stock, lighting, movement, aspect) and reference layers; the server composes the real prompt and generates the image. |
| **Storyboard** | Turns a script into storyboard panels, with cast cards and per-shot continuity. Exports to PDF. |
| **Assets** | The four "factories" that make production plates: **character**, **location**, **prop**, and **wardrobe** — each with its own recipe and correct aspect ratio (e.g. a face is 4:5, a turnaround is 32:9). |
| **Videos** | Animates a still into a clip using **Seedance 2.0** (BytePlus/ARK) or **Kling** (Kuaishou). |
| **Breakdown** (a.k.a. **Ad Breakdown 360**) | Deconstructs an existing commercial into a 13-axis "anatomy": shot/cut detection, timestamped dialogue (Arabic-first ASR), on-screen text, per-shot master prompts, and a client-ready pack. |
| **The Eye** | Ranks candidate images by how they *feel* (not by text). It "reads" an image on ten axes and can override naive text search. The scoring recipe is a guarded secret kept server-side / in the Electron main process. |
| **The Swap** | "The Eye run backwards": change exactly one element of an image (via a slots → consequence → plan → compose → verify pipeline) while preserving everything else. |
| **Reference Maker** / **Reference Scene** | Understands a reference image/scene and derives a reusable "contract," which can then be revised against a take. |
| **Context Agents** | A DNA-agnostic creative engine: given a small `{register, beat, energy, goal}` state, it retrieves methods + a profile + a trusted lexicon and runs a short chain of LLM calls. Recipe stays server-side. |
| **Context Eye** | The Eye applied inside Context Agents — picks the real reference frame that matches a feeling. |
| **Creative Mind** | An immersive brainstorming canvas (Zettelkasten-style "fleeting notes," braincards, "My Mind") that turns a brief into territories and a big idea. |
| **Film Space** / **HJEN SET** | A browser-native 3D stage with a placeable **mannequin** and focal-true lenses. Locks a camera angle into a reusable **Angle Pack** (plate + camera data + depth + outline + pose). Includes single-image body recovery (HMR/SMPL). |
| **Emulsion** | An offline, local camera-emulation post layer: **camera body × lens × film stock**, self-calibrating against a corpus of real cinema frames. Works on stills and video. |
| **Node canvas** | A wired node engine to chain tools into repeatable graphs (frame nodes → video nodes). |
| **Cuts** | An internal shot-boundary + representative-frame extractor used to analyse videos (shots, filmstrips, embeddings, per-shot briefs). |
| **HJEN Clipper** | A browser extension + a localhost bridge that "clips" web images into the studio's reference library. |
| **IDEA** | A Saudi Ad Voice agent graph (nodes N0–N8 plus an independent judge) for generating idea narration, dialogue, and voice-over in Saudi dialects. |
| **Mood Board** / **Timeline** | Detachable panel documents; the References timeline can be exported to MP4 or FCPXML. |
| **worldkit** | The Python ML sidecars bundled with the app — depth, pose, segmentation, and cut detection — used by Film Space / Emulsion. |

## Platform & infrastructure terms

| Name | What it is |
|---|---|
| **The gateway** | `hjen-server` running in front of the app: it holds the keys, meters usage, and forwards generations. "Gateway mode" is the app pointed at it with an invite token. |
| **Invitee / magic token** | An early-access account and its opaque access token. The token also doubles as a bearer credential for the API and the hosted MCP. |
| **Make** | One billable generation (image, video, or LLM call). One "make" = one credit reserved (and refunded on failure). |
| **The recipe / "the recipe lives on the server"** | The proprietary prompt for a tool. The client sends raw selections; the server (or the Electron main process) composes the real prompt so it never ships to a browser. |
| **Control port** | A local HTTP server the desktop app runs on `127.0.0.1` so `hjen-mcp` and the in-app Assistant can drive real app actions. |
| **`hjen-studio://`** | The app's deep-link protocol, used to navigate to an exact view and to hot-reload a document an agent just wrote. |
| **`hjen-file://`** | A custom Electron protocol the renderer uses to load local files (images/video) without base64 round-trips. |
| **`cloudgen://`, `cloudlib://`, `cloudcuts://`, `cloudbd://`** | Synthetic "path tokens" the web studio uses in place of local file paths; the server resolves them to per-account cloud storage. |
| **PPM** | The project/pipeline method — the 8-stage contract (Brief → References → Recast → Treatment → Screenplay → Assets → Frames → Videos) with per-stage "signing" (locking). |
| **The Control Plane / `/console`** | A React admin SPA in `hjen-server` (parallel to the older `/admin` page) for governing accounts, pricing, and usage. |

## External services

| Name | Role |
|---|---|
| **OpenAI** | Images (`gpt-image-2`), text, Whisper ASR. |
| **Anthropic** | Prompt enhancement, skills, breakdown "docs" stage. |
| **Google (Gemini)** | Vision passes for Breakdown. |
| **BytePlus / ARK / Seedance** | Video generation. |
| **Kling (Kuaishou)** | Video generation (second backend). |
| **Clerk** | Identity — verified accounts and organizations (team seats). |
| **Paddle** | Global payments (merchant of record, USD). |
| **Moyasar** | Saudi payments (mada / card / Apple Pay / STC Pay, SAR). |
| **Qoyod** | Saudi accounting / ZATCA e-invoicing. |
| **Caddy** | TLS reverse proxy in front of the server. |
