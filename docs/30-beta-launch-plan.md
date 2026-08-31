# Taking HJEN to beta — a concrete plan

You asked what it takes to launch to beta users, and gave six tasks. This page answers each one with a specific recommendation (not a menu), explains the "why," and maps it onto the code that already exists so it's actionable. It also sequences the work, because the six tasks have dependencies — doing them in the right order saves rework.

## The shape of the recommendation, up front

- **Beta = a closed, invite-only wave.** The gateway already supports invite waves, quotas, and expiry (`store.js`, the `/api/admin/*` routes). Use that. Aim for tens-to-low-hundreds of users, not open signup — it keeps scale honest and lets you fix things live.
- **Launch the web studio first.** The server already serves the full desktop renderer as a website (`/studio`), so the web path needs no second frontend and gives you one place to enforce auth, metering, and flags. Keep the desktop app for power users on the same backend.
- **Make the cloud authoritative.** For a metered, billed product you cannot trust the client for quota or history. The backend becomes the source of truth; the desktop app becomes a fast local mirror.
- **Pick the cheapest, easiest managed stack — don't buy sovereignty yet.** Data residency (in-Kingdom hosting) is **not** a beta requirement; it's an **enterprise feature you add later** as a custom per-customer instance (see "Data sovereignty" below). For beta, optimize for time-to-launch and cost. GCP Dammam and the `infra/gcp` Terraform are *one option, not a decision*, and the standalone `gcp-cloudrun` repo is a discarded experiment — not part of the product.
- **The single most important principle:** the backend already has the right *seams* (`cloudstore.js` is explicitly written to move to "Postgres + S3," `syncEngine.ts` + `/api/oplog` are a sync backbone, `store.js` centralizes metering). You are largely *filling in* those seams, not rebuilding.

Here's the dependency order. The rest of the page details each box.

```
 Phase 0            Phase 1                    Phase 2               Phase 3
 HARDEN         →   FOUNDATION            →    INSTRUMENT & GATE →   SYNC & LAUNCH
 (security         (Postgres + object         (PostHog events +     (cloud-first +
  blockers)         storage behind the         feature flags)        local mirror,
                    cloudstore seam)                                 then invite waves)
```

---

## 1. Database — use SQL (Postgres), on the cheapest managed host

**Recommendation: PostgreSQL, as a managed service on whatever is cheapest and fastest to stand up.** Not NoSQL. The *engine* choice (Postgres) is firm; the *host* is deliberately not — pick the easiest option now and move later if you ever need to.

**Why SQL wins here specifically.** Your data is relational and money-adjacent: accounts, plans, quotas, a credit ledger, projects, generations, payments, subscriptions. Two of those need real transactions:

- **Metering.** Today a credit is reserved by serializing file writes through one in-process promise chain (`store.js` `withLock` → `invitees.json`). That only works on a single node and is the reason the server can't scale. In Postgres this becomes one atomic statement:

```sql
UPDATE accounts
   SET gen_used = gen_used + 1
 WHERE id = $1 AND gen_used < gen_limit
 RETURNING gen_used, gen_limit;
```

  If it returns a row, the credit is reserved; if not, they're out of quota — race-free across any number of servers. Refund is the inverse in a transaction. This is exactly what SQL is for and what NoSQL would make you hand-roll again.

- **Payments.** Webhook settlement, idempotency, and the credit ledger want ACID guarantees.

**Why not NoSQL.** Mongo/Firestore/DynamoDB would push you back into manually coordinating the quota logic you're trying to fix, and your data isn't document-shaped in a way that benefits. The one place documents *are* natural — the per-project/per-account JSON blobs (`docs/`, board looks, stage state) — Postgres handles fine as `JSONB` columns. You get relational integrity where it matters and schemaless flexibility where it helps, in one store.

**Which host (cheapest + easiest first).** Two strong picks, both real Postgres:

- **Supabase** — managed Postgres **plus** S3-compatible object storage (task 2) in one dashboard, with a free tier and ~$25/mo after. This is the fastest path for a solo/AI-assisted founder: one vendor covers tasks 1 and 2. You already use Clerk for identity, so you only need Supabase's database + storage, not its auth.
- **Neon** — serverless Postgres that scales to zero (very cheap for bursty beta traffic), excellent DX; pair it with Cloudflare R2 for media (task 2).

Either is dramatically less setup and cost than a self-run Cloud SQL/RDS cluster. Lead with **Supabase** for simplicity; choose **Neon + R2** if you want best-in-class cheap media delivery. Don't stand up Cloud SQL/RDS for beta — that belongs to the enterprise/sovereign tier below.

**How to do it without a rewrite.** `cloudstore.js` and `store.js` are already the seam — their comment literally says the API is shaped to move to Postgres + S3 without changing the web adapter. Implement a Postgres-backed version behind the same function signatures, then migrate `invitees.json`, `events.jsonl`, and `accounts/*` into tables. Suggested first tables:

| Table | Replaces | Notes |
|---|---|---|
| `accounts` | `invitees.json` | quotas, plan, Clerk ids, payment ids |
| `entitlements` / `plans` | `PLANS` in `store.js` | which tools + limits per plan |
| `credits_ledger` | `events.jsonl` (billing rows) | append-only; the billing source of truth |
| `projects`, `generations` | per-account `projects.json` / `generations.json` | `generations` holds metadata; **bytes go to object storage** (task 2) |
| `payments` / `subscriptions` | Paddle/Moyasar state | idempotent by event id |

Keep `events.jsonl`-style product signals out of the DB — those go to PostHog (task 4). Postgres holds the *money truth*; PostHog holds the *behaviour*.

---

## 2. Object storage ("S3 bucket") — yes, cheapest S3-compatible option

**Recommendation: put all generated bytes in an S3-compatible object store, metadata in Postgres.** For beta, the cheapest good choices are **Cloudflare R2** (S3-compatible, **zero egress fees** — which matters a lot for an image/video-heavy app — and pairs with Cloudflare's CDN) or **Supabase Storage** (natural if you picked Supabase in task 1). Both are far cheaper and simpler than running a cloud bucket + CDN yourself. Plain AWS S3 works too but egress costs add up for media.

**What moves to the bucket:** generation images/videos, their resized WebP derivatives, the reference library, breakdown frames, avatars, and the recovery cache — everything currently under `data/accounts/<id>/…` on local disk. The Postgres `generations` row points at the object key; the object store holds the bytes.

**Why it's necessary now.** This is the other half of "make the server multi-instance" — local disk ties you to one box. It also sidesteps a real bug the code already warns about: the storage layer assumes atomic `rename`, which a mounted-bucket filesystem (e.g. GCS-FUSE) does **not** provide. Write to the bucket **through the S3 SDK/API**, not a mounted filesystem, and a reader never sees a half-written file.

**How to serve it safely.** Today images are served either through the authenticated API or via an unguessable token-in-URL path. Replace both with **short-lived signed URLs** (a few minutes' expiry) fronted by a CDN. That keeps the fast edge-cached delivery you already designed (`/i/<acc>/<pid>/<gid>/<w>.webp`) while fixing the "tokens in URLs" security finding. **Do not make the bucket public.**

**Derivatives.** Keep the resize-to-WebP step, but write the derivative into the bucket the first time and serve it from there (or use a CDN image-resizing feature and drop the ImageMagick dependency entirely).

---

## 3. Feature flags — use PostHog flags, enforce on the server

**Recommendation: PostHog feature flags** (same vendor as task 4, so one SDK and cohort targeting keyed on the account). Three needs, one system:

1. **Per-tool enablement.** A flag per tool (`tool.frame`, `tool.video`, `tool.breakdown`, …). The app already has an "available / soon" concept in `ProductHub`; drive it from flags so you can dark-launch a tool to yourself, then a cohort, then everyone. **The UI reads the flag to show/hide the tile, but the server must enforce it** — a disabled tool's endpoint returns 403. Never trust the client for entitlement; the gateway is the enforcement point.
2. **Bring-your-own LLM key.** Make this a per-account setting plus a flag (`byo-llm-key`). Two honest options, in order of preference:
   - **Desktop direct mode (preferred):** the desktop app already lets a user use their own keys locally, where the key never touches your server. Route BYO users there.
   - **Web BYO:** if you must accept a user's key server-side, store it with **envelope encryption via a KMS** (never plaintext, never logged), scope it to that account, and skip your metering for their calls. This interacts with security finding 1 — the fix there (pinning upstream URLs) must land first so BYO can't be abused to exfiltrate *your* keys.
3. **Everything else** (staged rollouts, A/B copy, kill-switches) is what flags are for. Use `%` rollouts and cohort targeting on the HJEN account id.

**Entitlements vs flags — keep them distinct.** Hard entitlements (quota, which plan gets which tools) live in Postgres (`entitlements` table, task 1). Flags are for *rollout and experiment*. Don't encode a paid plan boundary purely in a flag.

---

## 4. Product events — yes, PostHog

**Recommendation: PostHog**, which your own `ARCHITECTURE.md` already names, and which pairs with the flags in task 3. (A PostHog project is already connected.)

**Emit events from two places:**
- **Server-side, from the gateway** — the authoritative record of what happened: `signup`, `make_started` / `make_succeeded` / `make_failed` / `make_refunded` (with tool + model + cost), `quota_exhausted`, `upgrade_completed`. Key them by a **pseudonymous account id**.
- **Client-side** — UI funnels the server can't see: tool opened, project created, time-to-first-frame, which tiles get clicked.

**The funnels that matter for beta:** signup → first project → first make → repeat make (activation + retention), and upgrade viewed → started → completed (monetization). Per-tool usage tells you which of the ~31 tools to invest in.

**Keep it clean and compliant.** PostHog is for **behaviour**; the Postgres `credits_ledger` remains the **billing truth** — don't reconcile invoices from analytics. Respect PDPL/the telemetry stance already written down: no emails, IPs, or user content in events; in-region or EU hosting; IP anonymization; consent.

---

## 5. Fix the security issues — what actually blocks launch

Full detail is in the [Security review](#22-security); here it's split into *launch blockers* (fix before an external user touches it) and *fast-follows* (right after). Numbers refer to that page.

**Launch blockers** {sev:high}
- **Finding 1 — provider-key exfiltration.** Any invitee can currently steal your OpenAI/Anthropic/Google/ARK/Kling keys via the client-controlled upstream URL. This defeats the whole gateway. **Pin every provider base URL server-side; never accept a destination URL or auth headers from the client.** Do this first.
- **Findings 3 & 12 — `gcp-cloudrun`.** If you're not using it, **delete it**. If you are, stop dumping all secrets into env and remove the public `allUsers` invoker.
- **Finding 11 — tokens in URLs.** Move session/magic tokens out of query strings and `<img>` URLs (the signed-URL work in task 2 handles the image case). Rotate anything already exposed.
- **If MCP is exposed to beta users (findings 6, 7):** validate OAuth `redirect_uri` and complete paid-tool metering. If MCP stays internal-only for beta, defer.
- **If the desktop app ships to beta (findings 2, 4, 9):** confine `hjen-file://`, scope the file-read IPCs, and authenticate the control port.

**Fast-follows** {sev:medium}
- Move stored keys to `safeStorage` (desktop) / KMS (server) — finding 10.
- Harden the SSRF fetchers (`redirect: manual` + resolved-IP checks) — finding 5.
- Add security headers (CSP/HSTS/X-Frame-Options) and gate the `/console` + `/admin` static pages — findings 13, 14.
- Meter `/api/enhance` and `/api/skill/run` — finding 15.

**Bonus:** the Postgres migration (task 1) *is* a security fix — it removes the single-node quota race.

---

## 6. Cloud vs local for user output — cloud-first, local mirror

**Recommendation: the cloud is the source of truth; the desktop is a local mirror that syncs.** You already have the machinery for this.

- **Why cloud-first:** a metered, billed product can't let the client be authoritative for history or quota. Generations made through the gateway are *already* saved server-side ("survives a closed tab"). Lean into that — every make writes to Postgres (metadata) + the bucket (bytes) at creation.
- **Keep the local-first *feel* on desktop.** The desktop app stays fast and works offline, but treats the cloud as canonical and reconciles through the sync backbone that already exists: `/api/oplog` + a cursor + `syncEngine.ts`. The desktop pulls ops since its cursor to mirror down; local changes queue as ops to push up.
- **Keep the merge model simple for beta.** One user per account, last-write-wins per document, driven by the op-log. **Do not build CRDTs or real-time collaboration for beta** — it's a large project you don't need yet.
- **Offline desktop** can still generate in **direct mode** (own keys) with no server; those results sync up when it reconnects.

In one line: **cloud is truth, local is a cache, the op-log is the bridge, last-write-wins is good enough for beta.**

---

## Data sovereignty — an enterprise feature, not a beta cost

Sovereign, in-Kingdom hosting (GCP Dammam, an AWS KSA region, etc.) is real and valuable — but it's **expensive, slower to stand up, and unnecessary for a closed beta**. Treat it as a product tier, not a foundation:

- **Beta / standard plans:** one cheap, shared, easiest-to-run managed stack (Supabase or Neon + R2), hosted wherever is simplest. This is what everything above assumes.
- **Enterprise / data-sovereign plan (later):** for customers who require their data to stay in a specific jurisdiction, offer a **dedicated, custom-provisioned instance** — e.g. a stack in GCP Dammam or an AWS KSA region, isolated per customer. The `hjen-server/infra/gcp` Terraform is a **reference design** you can adapt for exactly this when the first such customer signs; it is not something to run for beta.

This turns a cost centre into a paid upsell: you don't pay for sovereign infrastructure until a customer is paying you for it, and the "one brain, many faces" architecture already makes it feasible to spin up an isolated backend per enterprise account without changing the clients.

> On the two GCP artifacts you'll see referenced elsewhere in these docs: `hjen-server/infra/gcp` is a well-written *reference* for that future enterprise instance, and the standalone **`gcp-cloudrun` repo is not part of the product** — a discarded cloud experiment to archive, not a deployment target.

## Putting it in order

| Phase | What ships | Depends on | Rough size |
|---|---|---|---|
| **0 — Harden** | Fix finding 1 (pin upstreams); retire/lock `gcp-cloudrun`; stop tokens in URLs; security headers; gate admin | nothing (do immediately) | days |
| **1 — Foundation** | Managed Postgres (Supabase/Neon) + object storage (R2/Supabase) behind the `cloudstore`/`store` seam; migrate data; transactional credit reserve/refund; signed-URL + CDN delivery | Phase 0 | the bulk of the work |
| **2 — Instrument & gate** | PostHog events (server + client); PostHog feature flags (per-tool, BYO-key, rollouts); entitlements table wired to plans | Phase 1 | 1–2 weeks |
| **3 — Sync & launch** | Cloud-first + local mirror via op-log finalized; BYO-key encrypted path; multi-instance load test; security fast-follows; open invite waves | Phases 1–2 | 1–2 weeks |

Phase 0 is independent of everything and removes the scariest risk, so start it today. Phase 1 is the foundation that unblocks multi-instance and makes the cloud authoritative — it's where most of the effort goes, and tasks 1, 2, and 6 all live there. Phases 2 and 3 layer instrumentation and polish on top.

## Decisions to confirm (I've picked a default for each)

These are genuine forks where I've made a call so you're not blocked — change any of them and the plan still holds:

- **Hosting stack → cheapest managed (Supabase, or Neon + Cloudflare R2).** Default, because it's the fastest and cheapest way to launch. The `infra/gcp` Terraform is a *reference design*, not a commitment, and the standalone `gcp-cloudrun` repo is not part of the product — don't treat either as the plan.
- **Data residency → not a beta constraint.** Host wherever is easiest and cheapest. In-Kingdom / sovereign hosting is offered *later* as an enterprise feature (custom instances), not something you pay for during beta — see the section below.
- **Beta surface → web-first, desktop for power users.** Default, because the server already hosts the studio and it's the easiest to gate and meter.
- **MCP for beta → internal only.** Default, so you can defer the MCP security fixes (findings 6, 7). Flip it on later once those land.
- **Billing scope → keep Paddle + Moyasar as-is.** Don't add a new billing system (e.g. Lago) for beta; just move the credit ledger into Postgres.
