# Security review

A review of the six repositories for security bugs and vulnerabilities. Every finding here was confirmed by reading the actual code; each lists the file and line, why it matters, and a concrete fix. It was cross-checked by a set of focused deep-scan passes (per-repo and a cross-repo secrets sweep).

**Framing.** This is a beta / soft-launch codebase built largely with AI codegen by a non-technical founder. Given that, the security posture is *better than expected*: provider keys are meant to stay server-side, payments are server-authoritative and webhook-verified, the metering is careful, and the sovereign GCP Terraform is well done. But the deep read surfaced one issue that **defeats the core "keys never leave the server" guarantee** (finding 1), and several others worth fixing. None suggest negligence — they're the kinds of gaps a security-focused review is meant to catch. **No hardcoded live secrets were found in any tracked file, and git history is clean of committed `.env` / key / credential files** (verified across all six repos with `git log --all` and object scans).

## Findings at a glance

| # | Severity | Repo | Issue |
|---|---|---|---|
| 1 | {sev:high} | hjen-server | **Provider API-key exfiltration** — client controls the upstream URL/base on `/v1/llm`, `/v1/llm-task`, `/v1/ark/*`, `/v1/kling/*`; the server injects the real key and sends it there |
| 2 | {sev:high} | hjen-app | `hjen-file://` serves **any** absolute path with `Access-Control-Allow-Origin: *` (no directory confinement) |
| 3 | {sev:high} | gcp-cloudrun | CI injects the **entire** GitHub secrets context (incl. the GCP SA key) into Cloud Run env vars |
| 4 | {sev:medium} | hjen-app | Broad **arbitrary local file read / URL fetch** via IPC, plus Chrome remote-debugging on `:9333` with `--remote-allow-origins=*` |
| 5 | {sev:medium} | hjen-server | **SSRF** family: `/api/fetch-url` follows redirects past its guard; `cuts` yt-dlp and `/v1/eye/rank` fetch authenticated user URLs |
| 6 | {sev:medium} | hjen-mcp | OAuth **`redirect_uri` not validated** against the registered client → auth-code interception |
| 7 | {sev:medium} | hjen-mcp | **Incomplete paid-tool metering** — 5 spending tools omitted from the metered set |
| 8 | {sev:medium} | hjen-mcp | Arbitrary local file read via `hjen_asset_view` / `hjen_asset_get` (any absolute path) |
| 9 | {sev:medium} | hjen-app | Local **control port** accepts commands with no authentication |
| 10 | {sev:medium} | hjen-app / hjen-mcp | Provider **API keys stored in plaintext** files (not `safeStorage`) |
| 11 | {sev:medium} | hjen-server | **Session/magic tokens and the admin token accepted in URL query strings** |
| 12 | {sev:medium} | gcp-cloudrun | Cloud Run service is **public** (`allUsers`) and **deploys on push to any branch** |
| 13 | {sev:low} | hjen-server | `/console` and `/admin` **static UIs served without auth** (their APIs are gated) |
| 14 | {sev:low} | hjen-server | Reflected-origin **CORS**; **no security headers** (CSP/HSTS/X-Frame-Options); binds `0.0.0.0` |
| 15 | {sev:low} | hjen-server | `/api/enhance` and `/api/skill/run` spend on Anthropic **without metering** |
| 16 | {sev:low} | hjen-server | Admin token compared with `!==` (**non-constant-time**) |
| 17 | {sev:low} | hjen-app | `child_process.execSync` with a string-interpolated `pkill` command |
| 18 | {sev:low} | hjen-server | Signup rate-limit keyed on a **spoofable** `x-forwarded-for` |
| 19 | {sev:low} | gcp-cloudrun | SA key file **not gitignored**; outdated Action pins; unpinned Python deps |
| 20 | {sev:low} | hjen-os | Founder **PII** (email) in tracked docs; `innerHTML` in local HTML tools |
| 21 | {sev:info} | hjen-app | `new Function('u','return import(u)')` dynamic-import shim |
| 22 | {sev:info} | all | Single-author risk factors: huge single files, hand-rolled auth/HTTP, single-node state |

---

## High severity

### 1. Provider API-key exfiltration via client-controlled upstream {sev:high}

**Where:** `hjen-server/src/server.js` — `/v1/llm` (~lines 1513–1519), `/v1/llm-task` (~1462–1468), `/v1/ark/submit` + `/poll` (~1144–1148, 1166), `/v1/kling/submit` + `/poll` (~1188–1192, 1214).

This is the most consequential finding, because it breaks the guarantee the whole architecture is built on. On the LLM proxy, the client supplies the **destination URL**, and the server injects the real provider key into the outbound request:

```
let upstreamUrl = String(body.upstreamUrl || '');   // ← from the client
const headers = { ...(body.headers || {}) };
if (provider === 'anthropic') headers['x-api-key'] = key;          // ← real server key
else if (provider === 'openai') headers['authorization'] = `Bearer ${key}`;
else if (provider === 'google') upstreamUrl = upstreamUrl.replace(/([?&]key=)[^&]*/, '$1' + key);
const upstream = await ... fetch(upstreamUrl, { method: 'POST', headers, body: ... });
```

Nothing checks that `upstreamUrl` is actually an OpenAI/Anthropic/Google endpoint. **Any authenticated invitee can set `upstreamUrl` (or `headers`) to a server they control and receive the server's OpenAI/Anthropic/Google key** in the `Authorization` / `x-api-key` header (or, for Google, in the URL query). The two video gateways have the same shape: `body.arkBase` / `body.klingBase` are client-controlled and the server attaches `ARK_API_KEY` / `KLING_API_KEY` to a request built on that base.

**Why it matters.** The entire point of the gateway is that clients never possess the provider keys — usage is metered and billed instead. This lets any invited beta user walk away with the company's raw provider keys (unlimited spend, no metering). It is post-authentication, but invite tokens are handed to external testers during a soft launch, so it is squarely in scope. Treat it as the top priority.

**Fix.** Do not accept a destination URL from the client. Hard-code each provider's base URL server-side and let the client specify only the path/model (validated against an allow-list). Never merge client-supplied `headers` into an authenticated upstream request. For the video gateways, drop `arkBase` / `klingBase` and pin the vendor bases in config.

### 2. `hjen-file://` serves any absolute path, with `ACAO: *` {sev:high}

**Where:** `hjen-app/electron/main.ts` — scheme registered at lines 69–71 (`bypassCSP: true, secure: true, supportFetchAPI: true, stream: true`); handler at lines ~498–541.

The custom protocol reads the requested path straight off disk with no confinement to a base directory, and returns it with `Access-Control-Allow-Origin: *`:

```
const u = new URL(request.url);
const fp = decodeURIComponent(u.pathname);   // e.g. /etc/passwd
const stat = fs.statSync(fp);
... headers: { ..., 'Access-Control-Allow-Origin': '*' }
```

The comment says "serve any path under the user's home," but the code serves **any** file the user can read (`hjen-file:///etc/passwd`, `…/.ssh/id_rsa`). `nodeIntegration` is off and `contextIsolation` on, so this is not direct RCE — but it is an **arbitrary local file read** primitive for the renderer origin, and `ACAO: *` makes the bytes cross-origin readable. Paired with finding 4's file-read IPCs, a single renderer XSS (the studio displays remote + AI-generated content and clipped web frames) becomes full local-file exfiltration.

**Fix.** Confine to an allow-list of roots (projects root, userData, app bundle, temp), resolve the real path, reject anything outside and reject symlink escapes. Drop `ACAO: *` (or restrict to media types), and reconsider `bypassCSP`.

### 3. CI injects the entire secrets context into Cloud Run {sev:high}

**Where:** `gcp-cloudrun/.github/workflows/deploy.yml` lines ~26–29 and ~60–69; `terraform/cloudrun.tf` lines ~37–43; SA key handling in `.github/actions/setup-gcp-authentication/action.yml` lines ~44–45.

```
TF_SECRETS=$(echo '${{ toJSON(secrets) }}' | jq -c '...')
echo "TF_VAR_dynamic_env_secrets=${TF_SECRETS}" >> $GITHUB_ENV
```

`toJSON(secrets)` serializes **every** GitHub Actions secret and Terraform sets them as **plaintext environment variables** on the Cloud Run service (`dynamic "env" { ... value = env.value }` — not Secret Manager references). That includes `GCP_SERVICE_ACCOUNT_KEY_FILE` — the deploy service-account key becomes a runtime env var. The key is also written to `gcp-sa-key.json` in the workspace with no cleanup.

**Why it matters.** Secret sprawl plus a service-account *key* exposed as an env var is a privilege-escalation gift to anyone who can read the service config or exec in the container. With finding 12 (public service, deploy-on-any-branch) the blast radius is large.

**Fix.** Pass only the specific secrets the service needs, by name; store them in **Secret Manager** and reference with `value_source.secret_key_ref` (as `hjen-server/infra/gcp/run.tf` already does); never put the deploy key in the runtime env; prefer **Workload Identity Federation** over a downloaded key.

---

## Medium severity

### 4. Broad arbitrary file read / URL fetch from the desktop app {sev:medium}

**Where:** `hjen-app/electron/main.ts` — `hjen:read-image-data-url` / `read-image-upload-data-url` (~L8438–8474, read any file → base64), `hjen:read-sidecar`, `hjen:doc-import` (copy arbitrary source files into a project), `hjen:fetch-url-base64` (~L1773, fetch any URL from the main process — no SSRF guard), and Chrome remote-debugging launch (`hjen:chrome-launch`, ~L2051–2087) on port **9333** with `--remote-allow-origins=*`.

These IPCs give the renderer a powerful set of primitives: read any local file, fetch any URL through the privileged main process, and reach a Chrome DevTools Protocol endpoint. Individually convenient; together they mean a renderer compromise (see finding 2) can read files, exfiltrate them, perform SSRF from the desktop, and potentially drive a CDP-controlled browser.

**Fix.** Scope file-read IPCs to the projects root / userData; add an SSRF guard to `fetch-url-base64`; bind the Chrome CDP port to a random loopback port with a token and drop `--remote-allow-origins=*`.

### 5. SSRF family on the server {sev:medium}

**Where:** `hjen-server/src/server.js` — `/api/fetch-url` (~L1356–1378); `hjen-server/src/cuts/engine.js` (~L258–300, yt-dlp on a user URL); `hjen-server/src/eye/rank.js` (~L100–108, fetches `candidates[].url`).

`/api/fetch-url` blocks private/loopback hosts on the *initial* URL but then calls `fetch(target.href, { redirect: 'follow' })` — a public redirector can bounce it to `169.254.169.254` or an internal host after the check, and the guard inspects the hostname string, not the resolved IP (so a domain resolving to a private IP passes). The Cuts yt-dlp fetch and the Eye's candidate-URL fetch are authenticated server-side fetchers with no private-range filtering. Unlike finding 1, these don't leak keys, but they let an authenticated user make the server reach internal targets.

**Fix.** `redirect: 'manual'` and re-validate every hop against the **resolved IP**; block the metadata IP; add allow-lists and size/time caps to the yt-dlp and Eye fetchers.

### 6. MCP OAuth `redirect_uri` is not validated {sev:medium}

**Where:** `hjen-mcp/src/http/oauth.ts` — `handleAuthorizeGet` (L32–40, only checks non-empty) and `handleAuthorizePost` (L64–80, redirects to whatever `redirect_uri` was supplied).

The OAuth server never checks that `redirect_uri` is one of the client's **registered** `redirect_uris`. Combined with open Dynamic Client Registration (anyone can `POST /register`), an attacker can craft an authorize link with their own `redirect_uri`; if a victim pastes their HJEN token into the (HJEN-hosted, convincing) consent screen, the authorization code is sent to the attacker, who exchanges it (they hold the PKCE verifier) for tokens bound to the victim's invitee — i.e. quota theft + read/write of the victim's projects.

**Why it's not fully mitigated by PKCE:** the attacker is the client here, so they generate the challenge and hold the verifier; PKCE doesn't help. The missing control is redirect-URI allow-listing per registered client. (Precondition: the victim must be phished into approving, which is why this is Medium rather than High — but the consent page being served from HJEN's own domain makes it more believable.)

**Fix.** Persist each client's `redirect_uris` at registration and reject any `redirect_uri` at `/authorize` that isn't an exact match; show the requesting client's identity on the consent screen.

### 7. Incomplete paid-tool metering on the hosted MCP {sev:medium}

**Where:** `hjen-mcp/src/http/serve-http.ts` line ~28 — `PAID_TOOLS = new Set([...])` lists only 6 tools (`hjen_frame_make`, `hjen_portrait_refine`, `hjen_video_make`, `hjen_chain_run`, `hjen_storyboard_shot_make`, `hjen_graph_run`).

Several other tools that actually spend (they call the same make-core) are **not** in that set, so over the HTTP transport they run without a quota decrement: `hjen_frames_make` (`tools/make.ts`), `hjen_storyboard_shots_make` (`tools/orchestrate.ts`), and `hjen_storyboard_assets_make` / `hjen_storyboard_panels_make` / `hjen_assets_make` (`tools/director.ts`). A hosted agent can spend the account's provider budget through these without being metered.

**Fix.** Derive "is this call paid" from a single source of truth shared with the tool implementations, or add every spending tool to `PAID_TOOLS`. Add a test that fails if a make-core-calling tool isn't metered.

### 8. Arbitrary local file read via MCP tools {sev:medium}

**Where:** `hjen-mcp/src/tools/ingest.ts` — `hjen_asset_view` (L132–153, reads any absolute image path → base64) and `hjen-mcp/src/tools/write.ts` — `hjen_asset_get` (L198–209, `fs.statSync` on any path). The make tools also read arbitrary `references` / `imagePath` paths and forward them to providers.

On the hosted HTTP transport, a valid bearer token therefore grants read access to any image file the server process can open, plus project mutation and paid API spend. This mirrors the desktop app's file-read exposure (finding 2/4) but over the network.

**Fix.** Confine these tools to the projects root / an allow-listed asset directory; reject absolute paths outside it.

### 9. Local control port has no authentication {sev:medium}

**Where:** `hjen-app/electron/main.ts` lines ~267–300 (`startControlPort`).

The desktop app runs an HTTP server on `127.0.0.1` (random port, written to `{userData}/mcp-control.json`) accepting `POST /navigate`, `/reload`, and `/command` with **no token check**. `/command` forwards an arbitrary `action` + `args` into the renderer.

**Why it matters.** Any process running as the user can discover the port and drive the studio. Local-only, but an unauthenticated command channel into the app.

**Fix.** Mint a random token at startup, store it in `mcp-control.json`, require it on every request (constant-time compare), and validate `Origin`/`Host`.

### 10. Provider API keys stored in plaintext {sev:medium}

**Where:** `hjen-app/electron/main.ts` (~L769, 780, 791, 1159, 1170, 1505) and `hjen-mcp/src/host-node.ts` (~L42–47) read/write `openai_key.txt`, `google_key.txt`, `anthropic_key.txt`, `replicate_key.txt`, `ark_key.txt`, `kling_key.txt` in userData (mode `0600`).

`0600` limits them to the user, but they aren't encrypted at rest, so any code running as the user (malware, a backup/sync tool) can read them, and they may land in backups. Correct behaviour for a desktop BYO-key app, but improvable.

**Fix.** Use Electron `safeStorage` (OS keychain). Mostly relevant to direct-mode power users; gateway mode keeps keys off the client entirely.

### 11. Session/magic tokens and admin token in URL query strings {sev:medium}

**Where:** `hjen-server/src/server.js` — `tokenOf()` (~L401–406) reads `?token=`; magic links `/s/<token>` (~L598–600); signup `statusLink` (~L668); the admin invitee list returns full `magicLink` values (~L2452); impersonate returns a magic link (~L2534). The web adapter also appends `&token=` to `<img>`/download URLs (`public/webapp/adapter.js` ~L68, 680–682).

Both **user magic tokens** (a bearer capability to the account) and the **admin token** can travel in URLs. Secrets in URLs leak into access logs, proxies, browser history, `Referer` headers, and CDN logs, and appear in the DOM/network panel.

**Fix.** Require tokens in the `Authorization` header; stop emitting them in query strings and `<img src>`. If images need token-free access, use the existing unguessable-id `/i/…` route. Rotate any tokens already exposed in logs.

### 12. Cloud Run service is public and deploys on any branch {sev:medium}

**Where:** `gcp-cloudrun/terraform/cloudrun.tf` lines ~65–70 (`allUsers` invoker); `.github/workflows/deploy.yml` lines ~4–6 (`branches: ['*']`).

Public-by-default plus deploy-on-any-branch is a weak exposure/supply-chain posture; benign while the app only returns "Hello there!", but combined with finding 3 a branch push can ship code to a public, secret-laden service.

**Fix.** Remove the `allUsers` binding; scope the deploy trigger to the default branch with required reviewers; least-privilege the deploy identity.

---

## Low severity

### 13. `/console` and `/admin` UIs served without auth {sev:low}
`hjen-server/src/server.js` — `/admin` (~L605), `/console` + `/console/*` (~L606–607). The admin **APIs** are gated by `requireAdmin`, so this is disclosure of the admin client bundle, not direct access. **Fix:** gate the static admin surfaces too. Note the console stores `ADMIN_TOKEN` in `localStorage` (`console/src/api.ts`), which is exposed to any XSS on that origin.

### 14. Reflected CORS, no security headers, binds `0.0.0.0` {sev:low}
`hjen-server/src/server.js` — reflected `Access-Control-Allow-Origin` (~L570–584), `server.listen(port, '0.0.0.0')` (~L2679), and no `Content-Security-Policy` / `HSTS` / `X-Frame-Options` (same for `hjen-mcp`). The CORS reflection is safe *today* because auth is bearer-only (no cookies), but becomes a vulnerability if cookie/session auth is ever added; the missing headers increase the impact of any XSS in `/studio` or `/admin`. **Fix:** explicit origin allow-list; add security headers at Caddy/Cloudflare or in-process; keep the firewall/reverse proxy in front of `0.0.0.0`.

### 15. Unmetered spend on `/api/enhance` and `/api/skill/run` {sev:low}
`hjen-server/src/server.js` (~L910–915, 1122–1127) call Anthropic without `store.consumeMake`. An invitee can drive Anthropic spend without decrementing quota. **Fix:** meter (or rate-limit) these like the other make paths.

### 16. Non-constant-time admin token compare {sev:low}
`hjen-server/src/server.js` (~L445) — `tokenOf(...) !== config.adminToken`. **Fix:** `crypto.timingSafeEqual` on fixed-length hashes.

### 17. `execSync` with an interpolated `pkill` {sev:low}
`hjen-app/electron/main.ts` (~L2070) — `` execSync(`pkill -f -- "--user-data-dir=${profile}"`) ``. `profile` is an app-derived path, not user input, so it's not currently exploitable, but it's the one spot that breaks the "no shell strings" rule the rest of the code follows. (Same pattern in the dev-only `gen_pattren*.js` with `sips`, mitigated by `JSON.stringify`.) **Fix:** `execFile('pkill', ['-f','--',\`--user-data-dir=${profile}\`])`.

### 18. Spoofable signup rate-limit key {sev:low}
`hjen-server/src/server.js` (~L107–116) trusts `cf-connecting-ip` / `x-forwarded-for`. If the server is ever reached directly, these are forgeable. **Fix:** only trust forwarded headers from the known proxy.

### 19. `gcp-cloudrun` hygiene {sev:low}
`gcp-sa-key.json` is **not** in `.gitignore` (only `*.pem` / `.env` are) — an accidental `git add .` could commit a full SA key. GitHub Action pins are old (`actions/checkout@v2`, `docker/setup-buildx-action@v1`), and `requirements.txt` is unpinned. `hjen-releases` has no `.gitignore` at all. **Fix:** ignore the key file and delete it after auth; pin actions and Python deps.

### 20. `hjen-os` PII and `innerHTML` {sev:low}
A founder email address appears in tracked docs (`00_company/org-structure.md`, `00_company/cap-table-decision-pack.md`), and local HTML/JS tools (`roadmap/Hjen_CapTable_Explorer.html`, `viz/static/*.js`) build DOM with `innerHTML` from hash/state. `hjen-os` is private and these tools are local, so risk is low — but the repo also holds commercially sensitive ownership/finance material, so keep access tight (and note its own `SECURITY.md` records that `main` branch protection is **not** enabled and org 2FA is **unverified**). **Fix:** treat the repo as need-to-know; enable branch protection + 2FA; escape interpolated values in the HTML tools if they're ever shared.

---

## Informational

### 21. Dynamic-import shim {sev:info}
`hjen-app/electron/main.ts` line 24: `new Function('u','return import(u)')` — a known CJS→ESM workaround; `u` is internally controlled, not an injection sink.

### 22. Structural risk factors {sev:info}
Not vulnerabilities, but they raise the odds one hides: **very large single files** (`electron/main.ts` ~9,700 lines with ~277 IPC handlers; `server.js` ~2,700 lines); **hand-rolled security-sensitive code** (JWT verify, HTTP router, OAuth, payments, rate-limiting — correct on review, but the burden is on this code, not audited libraries); **single-node state** (process-local job maps and rate-limit counters can't scale horizontally without losing paid renders — the code says so in `infra/gcp/run.tf`); and **no CI / no PRs** on the product repos (changes go straight to a branch).

## Things done well (worth preserving)

- **No hardcoded secrets** in any tracked file, and **no secrets in git history** (both verified).
- Metering discipline where it is applied: reserve-before, verify-before-commit, refund-on-any-non-delivery, idempotency keys.
- Payments are server-authoritative; Paddle and Moyasar webhooks are signature/secret verified and re-checked; the Moyasar `returnTo` redirect is same-origin-guarded.
- The hosted MCP endpoint does implement OAuth 2.1 + PKCE (S256) + DCR with bearer-required `/mcp` and `Host` allow-listing — a good foundation that needs the `redirect_uri` allow-list (finding 6) to be complete.
- `hjen-server/infra/gcp` is genuinely well-architected: least-privilege service account, secrets in Secret Manager with region-pinned replication, a GCS bucket with `public_access_prevention = enforced` + `uniform_bucket_level_access` + `prevent_destroy`, and a deliberate data-residency stance.
- Electron uses `nodeIntegration: false` + `contextIsolation: true`; most child-process calls use argv arrays (no shell); server file-serving sanitizes names and scopes reads to the account.

## Suggested priority order

1. **Stop accepting client-supplied upstream URLs/bases** on `/v1/llm*`, `/v1/ark/*`, `/v1/kling/*` (finding 1) — this leaks the crown-jewel keys and is the highest impact.
2. Confine `hjen-file://` and the file-read IPCs; drop `ACAO: *` and the CDP `--remote-allow-origins=*` (findings 2, 4).
3. **Archive/delete `gcp-cloudrun`** — the founder confirms it's not part of the product, which resolves findings 3, 12, and 19 outright. (Only fix its CI/IAM instead if you decide to keep it for something.)
4. Validate the MCP `redirect_uri` and complete paid-tool metering (findings 6, 7).
5. Harden the SSRF fetchers; stop putting tokens in URLs; authenticate the control port; move keys to `safeStorage` (findings 5, 11, 9, 10).
6. Sweep up the low/informational items (gate admin UIs, add security headers, meter enhance/skill, `.gitignore` the SA key, enable `hjen-os` branch protection).
