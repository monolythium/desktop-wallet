# Releasing the Monolythium desktop wallet

The cut-and-verify runbook for a signed, auto-updatable release. The pipeline is
`.github/workflows/release.yml` (a 4-platform build matrix + a release job that
generates the updater manifest). This doc is the process around it.

The app self-updates by polling
`https://github.com/monolythium/desktop-wallet/releases/latest/download/latest.json`
(pinned in `src-tauri/tauri.conf.json` → `plugins.updater`). Everything below
exists to put a correct, signed `latest.json` at that URL.

---

## 0. One-time prerequisites (CI secrets)

The workflow references these repository secrets. They cannot be verified from the
repo; confirm they are set in **Settings → Secrets and variables → Actions**.

| Secret | Purpose | Effect if missing |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Minisign key that signs the updater bundles; its public half is pinned as `plugins.updater.pubkey`. | **Missing `.sig` files for any supported OS → the release job fails loudly** (dead/partial-manifest guard). Auto-update cannot work without them. |
| `APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`, `APPSTORE_CONNECT_ISSUER_ID`, `APPSTORE_CONNECT_KEY_ID`, `APPSTORE_CONNECT_KEY_BASE64` | macOS Developer ID codesign + notarization (App Store Connect API key). | Both macOS legs fail and drop from the release. |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_CERT_PROFILE` | Windows Azure Trusted Signing. | Windows installer is built **unsigned** with a loud `::warning::` (auto-update still works via the minisign `.sig`; only first-install SmartScreen is affected). Set them to sign. |

Optional non-secret repo **Variables**: `AZURE_TRUSTED_SIGNING_ENDPOINT`
(default `https://eus.codesigning.azure.net/`), `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
(default `mono-labs`).

The `pubkey` in `tauri.conf.json` **must** correspond to `TAURI_SIGNING_PRIVATE_KEY`.
If you ever rotate the signing key, regenerate the keypair and update the pinned
pubkey in the same release — a mismatch makes every client reject the update.

---

## 1. Bump the version (three files must agree)

The version is declared in three places; `scripts/check-versions.mjs` fails CI if
they diverge. Edit all three to the new `X.Y.Z`:

- `package.json` → `"version"`
- `src-tauri/tauri.conf.json` → `"version"`
- `src-tauri/Cargo.toml` → `[package] version`

Then verify locally:

```
node scripts/check-versions.mjs      # must print "All three version sources agree"
```

> **The git tag is a fourth source of truth.** The workflow derives the published
> `latest.json` version from the tag (`vX.Y.Z` → `X.Y.Z`), while the built binary
> reports the in-file version. **Tag exactly what the three files say.** A tag ahead
> of the files makes the updater offer a version the installed binary never becomes
> → a perpetual "update available" loop. This is now **enforced**: the release job's
> first step runs `node scripts/check-versions.mjs "${TAG#v}"` and **fails the
> release loudly** if the tag doesn't equal the in-repo version — so a mismatched
> tag never reaches a build or a publish.

Commit the bump on `dev` / `master` per the branch convention, so branch CI runs
the version check before you tag.

---

## 2. Cut the release

Two ways to trigger `release.yml`:

- **Tag push (normal):** `git tag vX.Y.Z && git push origin vX.Y.Z`
- **Manual:** *Actions → Release → Run workflow*, set `tag` to `vX.Y.Z`
  (leaving `tag` empty does a **dry-run build with no upload** — useful to smoke the
  matrix without publishing). Optionally set `windows_trusted_signing_account`.

The **build** job (matrix, `fail-fast: false`) runs per OS:
`macos aarch64`, `macos x86_64`, `linux x86_64`, `windows x86_64` — builds, signs
(macOS notarized; Windows signed when Azure secrets exist, else unsigned + warning),
and emits the updater `.sig` bundles (requires `bundle.createUpdaterArtifacts: true`,
which is set).

The **release** job then:
1. downloads every platform's artifacts,
2. refuses to proceed if **zero** artifacts were produced (fully-failed matrix),
3. generates `latest.json` from the collected `.sig` files, and **fails loudly if
   any supported architecture/bundle entry is missing** (macOS app, Linux
   AppImage/DEB, or Windows NSIS/MSI); a partial manifest could strand users or
   make an installed bundle type reject bytes from a generic fallback,
4. uploads everything — including `latest.json` — as a **draft** GitHub release.

The matrix still completes every independent leg when one OS fails, but the release
does not publish until every supported updater target is present.

---

## 3. Review + publish the draft  ← the human gate that activates auto-update

The release is created as a **draft on purpose.** GitHub's
`releases/latest/download/…` path resolves **only to a published, non-prerelease
release** — a draft is not publicly reachable, so the updater endpoint 404s (the app
shows "up to date") until you publish.

On the draft (*Releases → the drafted `vX.Y.Z`*):
1. Confirm all four platforms' installers are present and check the run log for
   any Windows-signing warning.
2. Open `latest.json` and confirm every generic and installer-aware `platforms`
   entry has a non-empty `signature` and points at the matching release asset.
3. Review/curate the generated release notes.
4. Ensure it will be the **latest, non-prerelease** release, then **Publish**.

The moment it publishes, `…/releases/latest/download/latest.json` resolves and
auto-update goes live.

> **draft vs auto-publish — a process choice.** Keeping `draft: true` preserves the
> artifact-review gate above. If you prefer to auto-publish on every tag (the tag
> push becomes the only gate), set `draft: false` on the *Publish release* step in
> `release.yml`. The empty-manifest and require-an-artifact guards still prevent a
> broken/empty release either way.

---

## 4. Verify (per-OS install + N→N+1 auto-update)

The pipeline can only be certified by a real run — it has not been run end-to-end
yet. On a clean machine/VM per OS:

1. **Install:** download the installer from the published release and install.
   - macOS: `.dmg` launches with **no Gatekeeper block** (notarization stapled).
   - Windows: `.msi`/`.exe` installs with **no unsigned-publisher SmartScreen** warning
     (only when Azure signing is configured).
   - Linux: `.deb` installs / `.AppImage` runs.
2. **Auto-update (the crux):** install version **N**, then cut + publish **N+1**
   (repeat §1–§3 with a higher tag *and* matching bumped files). Launch the running
   **N** — the boot update banner should detect N+1 → **Install & relaunch** → the
   app downloads, verifies the signature against the pinned pubkey, installs, and
   relaunches as **N+1**. Confirm the About page then reads **N+1 / up to date**.
3. **Tamper check:** a bundle signed with the wrong key must be **rejected** — proves
   the pubkey pinning is live.

---

## 5. Channels

Single stream today: one endpoint, no beta/nightly. Publishing a build makes it the
one "latest" everyone auto-updates to. A stable/beta split (separate `beta.json` +
a user-facing channel selector) is planned for the pre-mainnet phase — not wired yet.
Until then, use draft review (§3) as the quality gate before a build reaches users.
