# `hjen-server` — the cloud gateway

This is the **backend**: a gated web-demo server that holds the real provider keys and turns the desktop generation core into a metered, billable, multi-tenant cloud service. Its own description says it best:

> Ports the desktop generation core behind an invitee gate with per-account quota + expiry + remote measurement. Zero runtime dependencies — runs on Node 18+ with no install.

- **Version:** `0.1.0`
- **Type:** Node.js HTTP server, **zero-dependency** at the core (built-in `node:http` only). The only runtime deps are `sharp` and `onnxruntime-node`, used by "the Eye."
- **Role:** Backend / API gateway / web host

## The core idea: "one brain, many faces"

The design doc (`docs/ARCHITECTURE.md`) states the founding rule: **every client speaks to the same API; no provider key ever ships to a client.** The server:

1. **Holds the keys** — OpenAI, Anthropic, Google, BytePlus/ARK (Seedance), Kling — read from environment variables only.
2. **Gates access** — every request carries either a magic-link **invite token** or a **Clerk session JWT**; each maps to a funded account with a quota and an expiry.
3. **Meters every make** — one credit is reserved before a generation and refunded automatically if it fails, so a customer is never charged for a make they didn't receive.
4. **Serves the studio as a website** — it serves the *exact same built React renderer* as the desktop app, injecting a "cloud adapter" so the unmodified UI runs against per-account cloud storage instead of local disk.

## Directory layout

| Path | What's in it |
|---|---|
| `src/server.js` | The entire HTTP server — ~2,700 lines, every route in one file |
| `src/config.js` | Env-only config loader (hand-rolled `.env` parser, no `dotenv`) |
| `src/clerk.js` | Clerk session-JWT verification (RS256 against JWKS) + Backend API lookups |
| `src/store.js` | The invitee store — accounts, quotas, atomic credit reserve/refund |
| `src/cloudstore.js` | Per-account file-backed cloud storage (projects, generations, library, recovery cache) |
| `src/providers/` | `openai.js`, `anthropic.js` provider adapters |
| `src/frame/`, `src/storyboard/`, `src/assets/` | Server-side prompt composition (the "recipe" that never ships to a browser) |
| `src/breakdown/` | Video ingest, transcription, and the multi-pass vision analysis |
| `src/eye/`, `src/swap/`, `src/reference/`, `src/contextagents/`, `src/cuts/` | The ported creative engines |
| `src/billing.js`, `src/moyasar.js`, `src/plans.js`, `src/pricing.js`, `src/money.js`, `src/qoyod.js` | Payments (Paddle + Moyasar), pricing, currency, and Saudi e-invoicing (Qoyod/ZATCA) |
| `src/scheduler.js`, `src/ratelimits.js`, `src/providerRetry.js` | Adaptive rate-limit handling for provider 429s |
| `console/` | A React "Control Plane" admin SPA (built to `console/dist`, served at `/console`) |
| `public/` | Static pages: `enter.html`, `join.html`, `studio.html`, `admin.html`, `upgrade.html`, and the web adapter |
| `infra/gcp/` | Production-grade Terraform for a sovereign GCP deployment in Dammam |
| `docs/` | `ARCHITECTURE.md`, `MOYASAR_SETUP.md`, `QOYOD_SETUP.md` |
| `eye/` | ONNX model weights + concept vectors for the Eye (data, synced separately) |

## Authentication model

Two credentials coexist, both resolved by `requireInvitee()`:

- **Magic-link token** — an opaque id (no dots). Created by the owner or by the Early-Access signup flow; doubles as the bearer token.
- **Clerk session JWT** — three dot-separated parts, verified in `clerk.js` against the instance JWKS (RS256, issuer + expiry checks). A signed-in Clerk user (or org) is mapped to a funded HJEN account, auto-created on first sign-in.

Admin endpoints are gated separately by `requireAdmin()`, which compares a bearer/query token to the `ADMIN_TOKEN` env var.

## API surface

The server exposes a large HTTP API. Grouped by purpose:

### Public / unauthenticated
- `GET /health`, `GET /` (`enter.html`), `GET /join`, `GET /demo`, `GET /upgrade`, `GET /admin`
- `GET /api/config` — public Clerk publishable key + frontend API (public by design)
- `POST /api/request-access` — Early-Access signup (rate-limited per IP, deduped by email)
- `GET /studio/…`, `GET /console/…` — the web studio and admin SPA (static assets)
- `GET /i/<acc>/<pid>/<gid>/<w>.webp` — token-free, edge-cacheable resized display images (paths are unguessable random ids)
- `POST /api/paddle/webhook`, `POST /api/moyasar/webhook`, `GET /api/moyasar/callback` — payment webhooks (verified by signature / secret, not by a session)

### Invitee (token or Clerk session required)
- `GET /api/session`, `GET /api/me` — identity + live quota
- Generation gateways — each reserves a credit, injects the server key, forwards to the provider, and refunds on failure:
  - `POST /v1/openai/*` — transparent OpenAI proxy for the desktop app
  - `POST /v1/llm`, `POST /v1/llm-task` — unified text-LLM proxy (Anthropic / OpenAI / Google); `-task` injects a server-side system prompt by id
  - `POST /v1/image/submit` + `/v1/image/poll` — async gpt-image jobs
  - `POST /api/frame` (+ `/submit`, `/poll`, `/recover`) — server-composed Frame recipe
  - `POST /api/storyboard` (+ `/submit`, `/poll`) and `POST /api/assets/submit` + `/poll`
  - `POST /v1/ark/submit` + `/poll` — Seedance video (BytePlus)
  - `POST /v1/kling/submit` + `/poll` — Kling video
  - `POST /v1/eye/rank`, `POST /api/engine/*` — the Eye / Swap / Reference / Context-Agent engines
  - `POST /api/cuts/*`, `POST /api/breakdown/*` — server-side ffmpeg + vision passes
- Cloud storage (the web renderer's backend, all scoped to the account id): `/api/projects`, `/api/doc`, `/api/gen`, `/api/gens`, `/api/files`, `/api/lib`, `/api/file`, `/api/sidecar`, `/api/oplog`, `/api/history`, `/api/profile`, `/api/avatar`, `/api/refs`
- `POST /api/fetch-url` — server-side fetch of a remote asset as base64 (has an SSRF guard on the initial host — see the security review for the redirect-follow gap)
- Billing: `GET /api/billing/config`, `GET /api/billing/portal`, `POST /api/moyasar/checkout`, `POST /api/moyasar/intent`

### Admin (`ADMIN_TOKEN` required)
- `GET /api/admin/invitees`, `/activity`, `/audit`, `/scheduler`, `/settings`, `/org`
- `POST /api/admin/create`, `/bulk`, `/approve`, `/reject`, `/plan`, `/wave`, `/extend`, `/stop`, `/activate`, `/bump`, `/impersonate`, `/pricing`, `/sar-rate`, `/maintenance`, `/qoyod/*`

## AI providers integrated

| Provider | Used for | Env var |
|---|---|---|
| OpenAI | Images (`gpt-image-2`), text, Whisper ASR | `OPENAI_API_KEY` |
| Anthropic | Prompt enhancement, skills, breakdown docs stage | `ANTHROPIC_API_KEY` |
| Google | Gemini vision passes for Breakdown | `GOOGLE_API_KEY` |
| BytePlus / ARK | Seedance 2.0 video | `ARK_API_KEY` |
| Kling (Kuaishou) | Kling video | `KLING_API_KEY` |

Video is **charged on submit and rendered at the vendor**; a background worker (`pollVideoJobs`, every 30s) polls each task to completion, downloads and saves the clip to the account (so a closed browser never loses a paid video), or refunds exactly once on failure.

## Data layer

There is **no database** — storage is file-backed under `DATA_DIR`:

- `invitees.json` — accounts, quotas, tokens (managed by `store.js`)
- `events.jsonl` — an append-only event log (signups, logins, makes, refunds, billing, admin audit)
- `accounts/<id>/…` — per-account projects, generation blobs, reference library, docs, recovery cache, avatars (managed by `cloudstore.js`)
- `videojobs.json` — pending server-side video renders

Writes are atomic (temp file + rename) and reads/writes to the quota are serialized to keep credit counting race-free. Image display variants are produced on demand with ImageMagick `convert` (concurrency-capped) and cached as WebP.

## Payments & Saudi compliance

- **Paddle** — merchant of record for global/USD checkout; webhook is HMAC-verified against the raw body.
- **Moyasar** — the Saudi rail (mada / card / Apple Pay / STC Pay, SAR). Amounts are always computed server-side, never trusted from the client; the webhook verifies a secret then re-fetches the payment from Moyasar before granting.
- **Qoyod** — Saudi accounting / ZATCA e-invoicing; dormant and dry-run by default until keys are set.

## Deployment

Two deployment paths exist, both in this repo:

1. **`deploy.sh`** (the live path today) — a one-command rsync-over-SSH deploy to a single Linux box (staging = `demo.hjen.ai`, prod = `app.hjen.ai` — not yet provisioned) running the server under `systemd`, fronted by Caddy for TLS. Per the repo's own docs the current box is in **Frankfurt**, not yet in the Kingdom. Secrets live in a gitignored `deploy.env`; `.env`, `node_modules`, `.git`, and `data/` are never synced.
2. **`infra/gcp/`** (a reference design, **not a committed target**) — production-grade Terraform for a **sovereign** GCP Dammam deployment: least-privilege service account, secrets in Secret Manager (region-pinned replication), a private VPC with Cloud NAT egress, and a GCS bucket with `public_access_prevention = enforced`. It's notably well-architected, but the cloud provider is **not decided** and this isn't the beta plan — its best use is as the blueprint for a *future enterprise / data-sovereign instance* (see [Beta launch](#30-beta-launch-plan)). It also warns that the single-node, filesystem-based storage layer isn't yet safe to run multi-instance.

## Notable strengths

- The metering discipline (reserve-before, verify-before-commit, refund-on-any-non-delivery) is careful and consistent across the generation paths that use it.
- Keys are *designed* never to leave the server, and are read from env only.
- Payment amounts are server-authoritative; webhooks are verified and re-checked; the Moyasar return redirect is same-origin-guarded.
- The sovereign GCP Terraform (`infra/gcp`) follows least-privilege and data-residency principles deliberately.

## The most important weakness

Despite the "keys never leave the server" design, the LLM and video gateways (`/v1/llm`, `/v1/llm-task`, `/v1/ark/*`, `/v1/kling/*`) let the **client choose the upstream URL/base**, and the server injects the real provider key into that request. Any authenticated invitee can therefore point it at a server they control and **exfiltrate the provider keys** — the single highest-impact issue in the system. That, plus token-in-URL leakage, an SSRF redirect gap, unmetered `/api/enhance` + `/api/skill/run`, reflected CORS, and the unauthenticated `/console` / `/admin` static pages, are all detailed in the [security review](#22-security).
