# `hjen-releases` — the auto-update feed

This is the smallest repo in the system. Its entire job is to be the **distribution channel** for the desktop app: it holds the signed & notarized macOS builds and the update feed that `HJEN Studio.app` checks.

- **Type:** Release/distribution repository (the binaries themselves live in GitHub Releases, not in the git tree)
- **Role:** Distribution

Its `README.md` in full:

> **HJEN Studio — Releases.** Signed & notarized desktop builds + the auto-update feed for HJEN Studio.app. Managed by the release pipeline.

## How it works

The desktop app (`hjen-app`) declares this repo as its update publisher in `package.json`:

```json
"publish": [
  { "provider": "github", "owner": "hjen-studio", "repo": "hjen-releases", "releaseType": "release" }
]
```

When `hjen-app`'s `npm run release` runs (`build/release.sh`), `electron-builder` builds, signs, notarizes, and publishes the `.dmg` / `.zip` plus the update metadata (`latest-mac.yml`) to this repo's GitHub Releases. On launch, packaged copies of the app use `electron-updater` to read that feed, download any newer version in the background, and install it on quit or on "Restart to update."

## Relationship to the rest of the system

- **Consumed by `hjen-app`** — this repo is the target of the app's auto-update mechanism. There is no code dependency in the other direction.
- It contains **no product code, no secrets, and no server logic**.

## Security note

The one thing worth stating: **the integrity of every desktop install depends on this update channel.** `electron-updater` verifies code signatures, and the builds are notarized, so the practical risk is low — but whoever controls this repo (and the signing identity) can ship code to every user's machine. Protect the publishing credentials and the GitHub repo permissions accordingly (branch protection, limited release-publishing rights, and 2FA on the `hjen-studio` org).
