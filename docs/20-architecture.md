# System architecture

This page describes how the pieces combine into one product. The guiding principle, stated in `hjen-server/docs/ARCHITECTURE.md`, is **"one brain, many faces"**: every client — desktop, web, AI agent — speaks to the same backend, and **no provider API key ever ships to a client**.

## The big picture

```
        ┌────────────────────────────────────────────────────────────────┐
        │                          CLIENTS                                 │
        │                                                                  │
        │   hjen-app (desktop)      web studio          AI agents          │
        │   Electron + React        (same React app,    (Claude, etc.)     │
        │        │   │              served by server)        │             │
        └────────┼───┼──────────────────┼───────────────────┼─────────────┘
                 │   │                   │                   │
        direct   │   │ gateway mode      │ HTTPS             │ MCP (stdio / HTTP+OAuth)
        keys     │   │ (invite token)    │                   │
                 │   ▼                   ▼                   ▼
                 │   ┌───────────────────────────┐     ┌──────────────┐
                 │   │        hjen-server         │◄────┤   hjen-mcp   │
                 │   │      "the cloud gateway"   │     │ (shares gate │
                 │   │                            │     │  + data dir) │
                 │   │  · invite / Clerk auth     │     └──────────────┘
                 │   │  · quota + expiry metering │
                 │   │  · server-side prompts     │
                 │   │  · per-account storage     │
                 │   │  · payments + accounting   │
                 │   └───────────┬───────────────┘
                 │               │  (server-side keys injected here)
                 ▼               ▼
        ┌──────────────────────────────────────────────────────────────┐
        │                       AI PROVIDERS                             │
        │  OpenAI · Anthropic · Google · BytePlus/Seedance · Kling       │
        └──────────────────────────────────────────────────────────────┘

   Payments:  Paddle (global/USD) · Moyasar (Saudi/SAR) · Qoyod (ZATCA e-invoicing)
   Updates:   hjen-app ──► hjen-releases (electron-updater feed)
   Infra:     beta = cheapest managed stack (host undecided) · infra/gcp = sovereign reference (enterprise-later) · gcp-cloudrun = not part of project
```

## The two runtimes of the same React app

The single most important architectural idea to understand is that **the desktop renderer and the web studio are the same code**.

- On the **desktop**, the React renderer talks to the Electron main process through the `window.hjen` bridge (defined in `preload.ts`). The main process reads and writes files on the user's local disk and calls providers (or the gateway).
- On the **web**, `hjen-server` serves that same built renderer, but injects an adapter (`/webapp/adapter.js`) that redefines `window.hjen` to call the server's HTTP API instead. Local file paths become synthetic tokens (`cloudgen://…`, `cloudlib://…`) that the server resolves to per-account cloud storage.

Because the two must match exactly, the bridge contract (`src/types/hjen-bridge.d.ts`) is the shared contract, and every creative "recipe" that runs in the desktop main process has a mirror endpoint in the server. This is why `src/eye`, `src/swap`, `src/reference`, `src/contextagents`, and `src/frame`/`storyboard`/`assets` exist server-side: the proprietary prompts must never be shipped to a browser, so they run behind the same seam on both runtimes.

## Where the "secret sauce" lives

A recurring law in the code: **the recipe lives on the server.** For Frame, Storyboard, Assets, and the ported engines, the client sends only *raw selections + reference metadata (+ image bytes)*; the actual prompt is composed server-side (`buildPrompt`, `buildStoryboardPrompt`, `buildAssetPrompt`, `buildSystem`) and never crosses the wire. On desktop, the same recipes live in the Electron main process, never in the renderer bundle. This keeps the differentiating IP off the client.

## The generation lifecycle (metering)

Every paid generation follows the same disciplined loop in `hjen-server`:

1. **Authenticate** the invitee (magic token or Clerk JWT) and check the gate (active, not expired, quota remaining).
2. **Reserve** one credit atomically (`store.consumeMake`) — no overdraw under concurrency.
3. **Inject** the real provider key and **forward** the request (with adaptive 429 handling via the scheduler).
4. **Verify before commit** — a 200 with no usable image/text is *not* a result.
5. **Refund** the credit on any failure, safety rejection, empty result, or exception (exactly once).
6. **Persist** the result to per-account storage (so a closed tab/app never loses a paid make) and **log** the event with real or estimated USD cost.

Long renders and video use an **async submit → poll** pattern to stay under Cloudflare's request-time ceiling, and a background worker completes video jobs independently of the client.

## Data & storage

- **No database.** State is file-backed under `DATA_DIR`: `invitees.json` (accounts), `events.jsonl` (append-only audit/usage log), and `accounts/<id>/…` (projects, generation blobs, library, docs, recovery cache).
- Writes are atomic (temp + rename); quota mutations are serialized.
- On desktop, the equivalent data lives on the user's disk under the projects root (default `~/Pictures/HJEN Studio`), and an optional **sync engine** mirrors cloud deliverables down to a local folder.

## Identity, billing, and compliance

- **Identity:** Clerk (JWT verified at the edge; organizations model team seats). Magic-link invites are the pre-Clerk / admin path.
- **Payments:** Paddle (global, merchant of record) and Moyasar (Saudi rail). Amounts are always server-authoritative; webhooks are signature/secret verified and re-checked before granting.
- **Accounting:** Qoyod for ZATCA-compliant e-invoicing (dormant until configured).
- **Data residency:** in-Kingdom hosting is a *planned enterprise option*, not the committed default. The `infra/gcp` Terraform (GCP Dammam, no global load balancer) is the reference for that future per-customer sovereign instance; beta runs on whatever managed stack is cheapest.

## Deployment topology

- **Today:** a single Linux VM (staging `demo.hjen.ai`, prod `app.hjen.ai` not yet provisioned) running the zero-dep Node server under systemd behind Caddy (TLS). Per the repo's docs the box currently sits in **Frankfurt**, not yet in the Kingdom. `deploy.sh` rsyncs code + the built web renderer to the box.
- **Next (for scale):** the hosting provider is **not decided**. The pragmatic plan (see [Beta launch](#30-beta-launch-plan)) is a cheap managed stack — managed Postgres + S3-compatible object storage — chosen for cost and simplicity, not sovereignty. The storage layer must move from local-filesystem semantics to direct object-storage writes before it can safely run multi-instance (the code says so itself).
- **Sovereign hosting is a *future enterprise feature*, not the default.** The well-written `hjen-server/infra/gcp` Terraform (GCP Dammam: Secret Manager, private VPC + Cloud NAT, locked-down GCS bucket) is a **reference design** to adapt when a data-sovereign enterprise customer signs — provisioned per-customer, not run for everyone.
- **`gcp-cloudrun`** is a standalone experiment that is **not part of the project** (a discarded cloud suggestion), and it isn't wired to any other repo.

## Architectural strengths and tensions

**Strengths**
- Clean "one brain, many faces" separation; keys truly stay server-side.
- The same renderer running on desktop and web is an elegant way to avoid a second frontend.
- Metering is careful and consistent; payments are server-authoritative.
- The MCP HTTP transport and the sovereign GCP Terraform are genuinely well done.

**Tensions (the AI-generated, single-author fingerprints)**
- **Monolithic files.** `hjen-app/electron/main.ts` (~9,700 lines) and `hjen-server/src/server.js` (~2,700 lines) hold enormous surface area in one file each — hard to review and easy to hide a bug in.
- **Hand-rolled everything.** Auth (JWT verify), an HTTP router, payments, and rate-limiting are all bespoke. Mostly done well, but it means the security burden is entirely on this code rather than on audited libraries.
- **Single-node assumptions.** Process-local job maps and rate-limit state mean the server can't yet scale horizontally without losing paid renders (the code says so itself).
- A handful of concrete security gaps, covered next.
