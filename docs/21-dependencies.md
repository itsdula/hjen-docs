# Inter-repo dependencies & data flow

This page answers "which repo depends on which," and how data actually moves between them at runtime. None of these are package dependencies (the repos aren't published to each other as libraries) — they are **runtime and build-time couplings**.

## Dependency map

```
                         ┌───────────────┐
                         │ hjen-releases │  ◄── (auto-update feed)
                         └───────▲───────┘
                                 │ electron-updater checks feed
                                 │ release.sh publishes builds
                         ┌───────┴───────┐
     ┌──────────────────►│   hjen-app    │◄─────────────────┐
     │  reads app's      │  (desktop)    │  drives app via   │
     │  data + keys      └───┬───────┬───┘  control port +   │
     │                       │       │      hjen-studio://    │
     │            gateway    │       │ direct                │
     │            mode       │       │ keys                  │
┌────┴─────┐  (invite token) │       │              ┌────────┴───────┐
│ hjen-mcp │◄────────────────┘       └─────────────►│  AI providers  │
│          │   shares invitees.json  ┌──────────────┤ OpenAI/Google/ │
│          │   (same gate + quota)   │              │ Anthropic/ARK/ │
│          ├─────────────────────────┤              │ Kling          │
└────┬─────┘                         │              └────────▲───────┘
     │                        ┌──────┴───────┐               │
     └───────────────────────►│ hjen-server  ├───────────────┘
       (points HJEN_MCP_DATA   │  (gateway)   │  injects server-side keys
        _DIR at server data)   └──────┬───────┘
                                      │ deployed by
                             ┌────────┴──────────┐
                             │ infra/gcp (in the │
                             │ hjen-server repo) │      gcp-cloudrun = separate scaffold
                             └───────────────────┘        (not wired to the others)

hjen-os = company knowledge base — no runtime link to any of the above
```

## Couplings, one by one

### `hjen-app` → `hjen-server` (runtime, optional)
The desktop app can run in **gateway mode**: its OpenAI SDK `baseURL` is set to `<server>/v1/openai` and it sends an invite token as the bearer. The server swaps in the real key, meters the make, and optionally saves the result to cloud storage. Configured via `{userData}/gateway.json`. Without a gateway, the app uses the user's own keys (direct mode).

### `hjen-server` → `hjen-app` (build-time)
The server **serves the desktop app's built renderer** as the web studio. `deploy.sh` runs `npm run build:web` inside `../app` and rsyncs `app/dist` to the box; `config.webappDir()` defaults to `../app/dist`. So the server literally hosts the app's compiled output, with a cloud adapter injected. This is the tightest coupling in the system — the web studio *is* the desktop renderer.

### `hjen-app` → `hjen-releases` (runtime + build-time)
Build-time: `release.sh` + `electron-builder` publish signed builds to this repo's GitHub Releases. Runtime: `electron-updater` reads the feed and self-updates. Declared in `hjen-app/package.json` → `build.publish`.

### `hjen-mcp` → `hjen-app` (runtime)
The MCP server **reads the same on-disk data the desktop app owns**: it mirrors the app's path layout (`src/paths.ts` ≈ `electron/main.ts`), auto-discovers the projects root and `{userData}/*_key.txt` keys, and can drive the running app through its **local control port** and the `hjen-studio://` deep-link protocol (hot-reload after a write).

### `hjen-mcp` → `hjen-server` (runtime)
The MCP's hosted HTTP transport **reuses the server's invitee gate**: point `HJEN_MCP_DATA_DIR` at the server's `DATA_DIR` and it reads the same `invitees.json`. The magic token doubles as a static bearer, and paid MCP tools decrement the same quota (with refunds). So an agent's spend is metered against the same account as the app's.

### `hjen-app`, `hjen-server`, `hjen-mcp` → AI providers (runtime)
All three ultimately call the same external providers (OpenAI, Google, Anthropic, BytePlus/ARK, Kling). The difference is *where the key lives*: on the client (app direct mode / MCP with local keys) or on the server (gateway mode / hosted MCP).

### `hjen-server` → `infra/gcp` (reference only)
A **reference** cloud design (Terraform) lives **inside the `hjen-server` repo** (`infra/gcp`) — kept as the blueprint for a possible future enterprise/sovereign instance, not a committed deployment or the beta plan. It is unrelated to the standalone `gcp-cloudrun` repo.

### `gcp-cloudrun` → (nothing)
The `gcp-cloudrun` repo is standalone and, per the founder, **not part of the project**. Its Terraform, CI, and stub FastAPI app are not referenced by any other repo. Treat it as a discarded cloud experiment to archive.

### `hjen-os` → (nothing, at runtime)
`hjen-os` is the company knowledge base and business tooling. It documents and plans the product but has **no runtime or build coupling** to the software repos.

## The shared contracts that keep couplings honest

Because so much is coupled by convention rather than by a package boundary, three "contracts" are load-bearing — if they drift, things break silently:

| Contract | Owned by | Mirrored by | Risk if it drifts |
|---|---|---|---|
| `window.hjen` bridge shape (`src/types/hjen-bridge.d.ts`) | `hjen-app` renderer | `hjen-server` web adapter (`adapter.js`) | Web studio breaks against the same renderer |
| On-disk path layout (`electron/main.ts`) | `hjen-app` main process | `hjen-mcp` (`src/paths.ts`) | MCP reads/writes the wrong project files |
| Invitee record shape (`invitees.json`) | `hjen-server` (`store.js`) | `hjen-mcp` gate (`src/http/gate.ts`) | Metering/auth mismatch between app and agent |

## Runtime data-flow example: making a Frame in gateway mode

1. The user composes a Frame in the studio (desktop or web).
2. The client sends **raw selections + reference-layer metadata + image bytes** (not the prompt) to `hjen-server` `POST /api/frame/submit` with the invite token.
3. The server authenticates, checks the gate, **reserves one credit**, composes the real prompt (`buildPrompt`), and calls OpenAI with the server-side key.
4. On success it saves the PNG to the account's cloud storage (`cloudgen://…`) and logs the make; on failure it refunds the credit.
5. The client polls `POST /api/frame/poll` and receives either a token to the stored image (served resized + edge-cached via `/i/…`) or the base64 directly.
6. If the user has desktop sync enabled, the sync engine later mirrors the deliverable to a local folder.
