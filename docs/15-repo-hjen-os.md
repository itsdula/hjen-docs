# `hjen-os` — the company operating system

This repo is the odd one out: it contains **no product code**. It is HJEN's "company operating system" — a private, structured knowledge base for strategy, research, decisions, ownership, finance, and fundraising. It documents and plans the product, but nothing here runs as part of the software.

- **Type:** Markdown knowledge base + Python financial/cap-table model + Cursor/Claude agent tooling
- **Role:** Company knowledge & business operations (not part of the running product)

## What it is

Its own README describes it as "the shared operating system for HJEN … one place for company knowledge, strategy, research, decisions, ownership, and execution context." It runs on a deliberate **three-system rule**:

| Question | Canonical home |
|---|---|
| What does HJEN know, believe, or decide? | This GitHub repo |
| What is HJEN doing, who owns it, when is it due? | GitHub Issues + one GitHub Project |
| Where is the actual deck/model/contract/media? | Google Drive |

A key discipline runs through it: a statement is only "official" once it's an approved file, an accepted decision record (ADR), or an approved linked source — "AI conversations are working sessions, not company memory." Everything else is explicitly tagged **Confirmed / Working assumption / Proposal / Open question / Superseded**.

## Structure

The numbered directories are the knowledge base; the named ones are tools and data.

| Area | Purpose |
|---|---|
| `00_company` | Company definition, vision, positioning, business model, org structure, terminology |
| `01_product` | Product thesis, architecture, roadmap, personas, use cases, shipped-build inventory |
| `02_market` | Market evidence, sizing, competitors, Saudi + global context |
| `03_gtm` | Community, partnerships, enterprise, government, distribution |
| `04_finance` | Assumptions, unit economics, model links |
| `05_fundraising` | Investment narrative, roadmap, pipeline, FAQ, data-room index |
| `06_operations` | Ownership, cadence, KPIs, the 107-task execution plan, source-of-truth rules |
| `07_research` | Research index, standards, evidence |
| `08_decisions` | Accepted / proposed / superseded decision records (ADRs) |
| `09_meetings` | Decision-oriented meeting notes |
| `10_pitch` | Narrative, slide map, claims register |
| `models` | **The financial & cap-table model** — a Python package (YAML assumptions + engines), not a spreadsheet |
| `viz` | A local read-only web viewer over the model (`python -m viz` → `127.0.0.1:8787`) |
| `spending`, `market`, `roadmap`, `kb`, `tech`, `regulatory`, `brand`, `docs` | Supporting data and drafts |
| `patches`, `tools` | One-off provenance scripts and scheduling/issue-runner helpers |
| `plugins`, `.claude`, `.cursor` | The `models` CLI packaged as an agent "skill," kept byte-identical in three copies |

Root build scripts (`build_captable.py`, `build_finmodel.py`, `verify_captable.py`, `package.json`) generate the finance/cap-table artifacts.

## The financial model is unusually rigorous

Worth calling out because it's the technical heart of this repo: the `models` package is a Python model with a CLI (`python -m models ask "…"`), a `doctor` command that reports structural weaknesses a passing test can't see, and a `mutate` command that injects deliberate faults to check the test suite actually objects. The README candidly reports the results of a mutation run (129 injected faults, 81 survived a green suite before hardening) — an honesty about model reliability that most startups never write down.

## What it says about the product (authoritative context)

The product-facing files (`01_product/`, `00_company/`) frame HJEN Studio as an "AI filmmaking platform" spanning seven recovered domains: **AI tools and agents; project and asset management; production workflows; cloud infrastructure; authentication and access; billing; administration.** That maps cleanly onto what the code actually implements across `hjen-app` and `hjen-server`. The thin `product-architecture.md` is labelled "working assumption"; the **authoritative** product inventory (kept in sync with the code) is `01_product/shipped-build-inventory.md` and `build-state-from-source.md`, which correctly record 31 tools, the two-host (desktop + web adapter) model, and honest caveats such as "The Swap" being reference-image persuasion rather than model-independent conditioning.

## Security & sensitivity notes

This repo is a **business** artifact, so the security concerns are about governance and confidential material, not runtime vulnerabilities:

- **It is a private repo and is meant to stay private.** Its own `SECURITY.md` sets clear rules: never store passwords/API keys/tokens, national IDs, banking details, signed instruments (SAFEs, term sheets), or third-party-confidential investor terms — those go in restricted Google Drive with only a safe pointer in `links/`. The generated cap-table workbook is kept out via `.gitignore`.
- **It deliberately does contain structural ownership/equity and financial-model data.** That's by design (the company must reason about equity and runway), but it means the repo holds commercially sensitive information — access should be tightly controlled. A founder email address also appears in a couple of tracked files (`00_company/org-structure.md`, `cap-table-decision-pack.md`) — minor PII, worth scrubbing if the repo's audience ever widens.
- **Governance gaps it admits to itself:** branch protection on `main` is **not enabled** (≈30 commits went straight to `main`), and org-wide 2FA is **unverified**. These are flagged in its own README/SECURITY.md as live decisions for an org owner.
- **No committed secrets were found** in this repo (consistent with its own policy).

**Bottom line:** `hjen-os` is well-organised and unusually self-aware about the limits of its own claims. The action items are organizational — enable branch protection, confirm 2FA, and keep the "never store here" list enforced — rather than code fixes.
