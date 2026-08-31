# `hjen-mcp` — the studio as an MCP server

This repo makes the entire studio **agent-drivable**: it exposes HJEN's tools through the **Model Context Protocol (MCP)**, so an AI agent (Claude Code, Claude Desktop, or the studio's own in-app Assistant) can read a project and drive real generations — the same idea as Higgsfield's or Martini's MCPs.

- **Version:** `0.1.0`
- **Type:** Node.js MCP server, **zero-dependency** (no `@modelcontextprotocol/sdk`, no `zod`, no npm) — it hand-rolls JSON-RPC 2.0 and runs on Electron's bundled node.
- **Role:** Backend / AI-agent integration

## Three surfaces, one server

The same tool implementations are exposed three ways:

1. **External agent → HJEN** — an agent drives HJEN over **stdio** (`claude mcp add hjen …`).
2. **In-app Assistant** — the studio's own Assistant panel calls the same tools on the user's canvas.
3. **HJEN → external MCP** — HJEN can mount *other* MCP servers and use their tools inside its pipeline (prefixed `ext__<name>__`).

## Directory layout

| Path | What's in it |
|---|---|
| `src/index.ts` | Entry point (stdio transport) |
| `src/mcp/server.ts` | The zero-dep MCP core (JSON-RPC 2.0) |
| `src/server-factory.ts` | Builds the server + registers all tools |
| `src/host.ts`, `src/host-node.ts` | The "Host" seam — resolves projects root, userData, and keys headlessly |
| `src/paths.ts` | On-disk path builders (a 1:1 mirror of the desktop app's `electron/main.ts`) |
| `src/tools/` | The tool implementations (`read.ts`, `write.ts`, `make.ts`, `director.ts`, `ingest.ts`, `orchestrate.ts`) |
| `src/providers/` | Zero-dep REST clients for OpenAI + BytePlus |
| `src/http/` | The hosted HTTP transport: `serve-http.ts`, `oauth.ts`, `oauth-store.ts`, `gate.ts`, `metadata.ts` |
| `src/resources.ts`, `src/prompts.ts` | MCP resources and PPM prompt templates |
| `scripts/selftest.mjs` | Self-test |
| `build.sh`, `run.sh`, `serve-http.sh`, `try.sh`, `Caddyfile.example` | Build/run scripts and a TLS reverse-proxy example |

## What it exposes

**Resources** — `hjen://projects`, `hjen://project/{id|slug|name}` (the full 8-stage project contract), `hjen://models`, `hjen://dna`, `hjen://register`.

**Tools** — roughly **36**, across 8 modules (`read`, `write`, `make`, `orchestrate`, `ingest`, `conversations`, `studio`, `director`). The README's "22 tools" is stale — the code registers more, including live "director" tools that drive the running desktop app. Grouped by purpose:

- **Read / orient:** `hjen_projects_list`, `hjen_project_overview`, `hjen_storyboard_read`, `hjen_graph_read`, `hjen_generations_list`, `hjen_library_list`, `hjen_models_list`.
- **Author the contract:** `hjen_project_create`, `hjen_stage_write`, `hjen_stage_sign`, `hjen_stage_set_current`, `hjen_ledger_add`, `hjen_storyboard_shot_upsert`, `hjen_graph_upsert`, `hjen_asset_get`.
- **Make (paid, cost-guarded):** `hjen_frame_make`, `hjen_frames_make`, `hjen_portrait_refine`, `hjen_video_make`, plus `hjen_job_get` / `hjen_job_wait` for async jobs.
- **Orchestrate:** `hjen_chain_run` (Frame → Refine → Video), `hjen_storyboard_shot_make`, `hjen_storyboard_shots_make`, `hjen_graph_run`.
- **Ingest / view:** `hjen_asset_upload`, `hjen_asset_view`.
- **Conversations / studio / director:** `hjen_conversations_list`, `hjen_conversation_get`, `hjen_studio_open`, and live-drive tools (`hjen_storyboard_set_script`, `hjen_storyboard_breakdown`, `hjen_storyboard_cast`, `hjen_storyboard_assets_make`, `hjen_storyboard_panels_make`, `hjen_assets_make`).
- **Prompts:** `hjen_ppm_pipeline`, `hjen_frame_brief`, `hjen_casting_brief`, `hjen_dna_lock`.

**Cost guard:** every paid tool is a dry-run returning an `estimateUsd` unless the caller passes `confirm: true`. Nothing is spent or saved without explicit confirmation. Note, however, that over the hosted HTTP transport the *quota* metering only covers 6 of the paid tools — see the security review (finding 7).

## How it connects to the rest of the system

- **Shares the desktop app's data.** It auto-discovers the projects root (`settings.json.projectsRoot` or `~/Pictures/HJEN Studio`) and reads the same JSON files the desktop app writes — the project contract, storyboard, node graph, generations, and library. Overridable via `HJEN_PROJECTS_ROOT`, `HJEN_USERDATA`, `HJEN_DNA_FILE`, `HJEN_REGISTER_FILE`.
- **Shares the desktop app's keys.** It reads keys from env (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `ARK_API_KEY`) or falls back to the app's `{userData}/*_key.txt` files.
- **Reuses `hjen-server`'s invitee gate.** The hosted HTTP transport reads the **same `invitees.json`** the server uses (point `HJEN_MCP_DATA_DIR` at the server's data dir): the magic token doubles as a static bearer, and paid tools decrement the same quota, with refunds on failure.
- **Drives the desktop app.** Through the app's local control port and the `hjen-studio://` deep-link protocol (Phase 3b), an agent's writes can hot-reload the exact view in the running studio.

## The hosted HTTP transport (strong foundation, two gaps)

`src/http/serve-http.ts` implements a **Streamable-HTTP + OAuth 2.1** endpoint using only `node:http` and `node:crypto`:

- `POST /mcp` requires a bearer token; unauthenticated requests get a proper `401` + `WWW-Authenticate` challenge pointing at the resource metadata.
- OAuth 2.1: Dynamic Client Registration (`/register`), `/oauth/authorize` with **PKCE (S256)** and a consent screen, `/oauth/token`, and the `.well-known/oauth-protected-resource` + `oauth-authorization-server` discovery documents.
- **Static Bearer** fallback: the invitee magic token (or `HJEN_MCP_DEV_TOKEN` for local dev).
- **Host allow-listing** (`ALLOWED_HOSTS`) rejects requests with an unexpected `Host` header (a DNS-rebinding guard).
- Binds to `127.0.0.1` by default; a public endpoint is meant to sit behind Caddy for TLS (`Caddyfile.example`).

This is the most carefully written network-facing code in the project and follows the MCP auth spec closely — but the deep review found two real gaps it needs before it's production-safe: the OAuth `redirect_uri` is **not validated against the registered client** (auth-code interception, security finding 6), and quota **metering is incomplete** (only 6 of the paid tools are gated over HTTP, finding 7). It also inherits the powerful local tools — a valid bearer grants arbitrary-image-file reads via `hjen_asset_view` (finding 8).

## Build & run

```bash
./build.sh          # compiles src → dist using the app's tsc on Electron's node
./run.sh            # stdio server
./serve-http.sh     # hosted HTTP server → http://127.0.0.1:8788/mcp

# add to Claude Code:
claude mcp add hjen --scope user -- "/absolute/path/to/mcp/run.sh"
```
