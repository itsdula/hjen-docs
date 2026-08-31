# HJEN — System Overview

HJEN is a **Saudi-DNA AI media-generation studio** for film and campaign production. Where a tool like Higgsfield gives you a general "type a prompt, get a video" box, HJEN is built as a set of **job-specific creative tools** — character development, mood boards, storyboards, ad breakdowns, camera/lens emulation, and more — all wired into one connected project so a piece of work travels from brief to finished frames and videos without leaving the studio.

This documentation was reverse-engineered by reading all six repositories in `~/Dev/hjen`. It explains what each repository does, how they depend on each other, the overall system architecture, and a security review. It changes **no code** — it only describes what is there.

> **Context that shaped this review.** The codebase was built by an artist founder using AI to generate most of the code. That shows in two ways worth stating up front. First, the *product* is unusually deep and coherent — the creative tooling is genuinely sophisticated. Second, the *engineering* has the fingerprints of AI-assisted, single-author development: enormous single files, lots of inline prose comments, hand-rolled implementations of things that libraries usually handle (auth, payments, an HTTP server), and a handful of security rough edges that a security-focused engineer would catch in review. The security section is written to be actionable, not alarmist.

## The six repositories at a glance

| Repo | What it is | Language / stack | Role |
|---|---|---|---|
| `hjen-app` | The **desktop studio** — the actual product users run | Electron + React + TypeScript + Vite, Python ML sidecars | Frontend / client |
| `hjen-server` | The **cloud gateway** — holds the API keys, meters usage, gates access, and serves the web version of the studio | Node.js (zero-dependency), Docker | Backend |
| `hjen-mcp` | The studio exposed as an **MCP server**, so AI agents (Claude, etc.) can drive it | Node.js (zero-dependency), stdio + HTTP/OAuth | Backend / integration |
| `gcp-cloudrun` | A standalone **GCP Cloud Run** experiment — **not part of the product** (a discarded cloud suggestion) | Python (FastAPI), Terraform, GitHub Actions | Not part of the project |
| `hjen-releases` | The **auto-update feed** — signed desktop builds are published here | (mostly empty; GitHub Releases host the binaries) | Distribution |
| `hjen-os` | The **company "operating system"** — business knowledge base, finance models, pitch decks, brand | Markdown + Python build scripts, Cursor/Claude plugins | Company docs (not product) |

## How they fit together (30-second version)

- **`hjen-app`** is the product. It's a macOS desktop app. It can run in two modes: with the user's **own API keys** (power-user / offline), or pointed at the **gateway** (`hjen-server`) using an invite token, so the keys stay on the server and usage is metered and billed.
- **`hjen-server`** is "one brain, many faces." It holds the real provider keys (OpenAI, Google, Anthropic, BytePlus/Seedance, Kling), meters every generation, enforces per-account quotas and trial expiry, handles payments (Paddle globally, Moyasar for Saudi Arabia), and — cleverly — serves the *exact same desktop React app as a website* by injecting a cloud storage adapter.
- **`hjen-mcp`** wraps the same studio capabilities as tools an AI agent can call. It reads the same project files as the app and can reuse the gateway's invite tokens for auth and billing.
- **`gcp-cloudrun`** is a standalone cloud experiment that is **not part of the project** — a discarded suggestion, not wired to anything. The cloud provider/host is undecided; `hjen-server/infra/gcp` is a *reference* design kept for a possible future enterprise/sovereign instance, not the committed plan.
- **`hjen-releases`** is where the desktop app checks for updates (via `electron-updater`).
- **`hjen-os`** is the business brain — it is not part of the running software.

```
                 ┌──────────────────────────────┐
   desktop  ─────►│                              │
   (hjen-app)     │        hjen-server           │────► OpenAI / Google / Anthropic
                  │      "the cloud gateway"     │────► BytePlus (Seedance) / Kling
   web studio ───►│  keys · quota · billing ·    │
   (served by     │  per-account cloud storage   │────► Payments: Paddle · Moyasar
    the server)   │                              │
                  └──────────────────────────────┘
   AI agents  ───► hjen-mcp ───► (same tools; can call hjen-server / providers)

   hjen-app ──(auto-update)──► hjen-releases
   hjen-os  = company knowledge base (separate from the running product)
```

## What the product actually does

The studio is organised as an eight-stage pipeline — **Brief → References → Recast → Treatment → Screenplay → Assets → Frames → Videos** — plus a set of specialised creative tools that sit alongside it:

- **Frame** — makes a still image from a "director's language" of selections (camera, lens, film stock, lighting, movement) plus reference layers.
- **Assets** — the four "factories": **character**, **location**, **prop**, and **wardrobe** plates with continuity.
- **Storyboard** — script in, panels out, with cast cards and per-shot frames.
- **Videos** — animates stills through Seedance (BytePlus) and Kling.
- **Breakdown** — deconstructs any existing commercial into a 13-axis anatomy: shot detection, Arabic-first transcription, on-screen text, per-shot prompts, and a client-ready pack.
- **The Eye** — ranks candidate images by how they *feel*, not just by text match.
- **The Swap** — the Eye run backwards: change one thing in an image while preserving the rest.
- **Reference Maker**, **Context Agents**, **Creative Mind**, **Film Space**, **Emulsion** (camera-body × lens × film-stock emulation), a **Node canvas**, **Mood Board**, and **Timeline**.

Each of these appears twice in the code: as an Electron main-process handler in the desktop app, and — for the web version — as a matching endpoint in `hjen-server`, because the "secret sauce" (the exact prompts) must stay server-side and never ship to a browser.

## How to read the rest of these docs

- **The repositories** — one page per repo, describing purpose, structure, endpoints/handlers, and external connections.
- **Architecture & security** — the whole-system architecture and data flow; the inter-repo dependency map; and the security review with findings ranked by severity and specific file/line references.
- **Reference** — a glossary of HJEN's many internal codenames (the Eye, the Swap, Cuts, Context Agents, worldkit…).

Use the search box (top-left) to jump to anything — it searches the full text of every page.
