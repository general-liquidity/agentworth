# Releasing

Every package in this repo publishes from CI via [`.github/workflows/release.yml`](.github/workflows/release.yml).
No manual `npm publish` + interactive 2FA: tokens do the auth, and each registry is
opt-in so nothing publishes by accident.

## One-time setup (per registry you want automated)

In **Settings → Secrets and variables → Actions**:

| Registry | Set variable | Add secret |
|---|---|---|
| npm (`@general-liquidity/opensolvency`, `…-mcp`) | `PUBLISH_NPM=true` | `NPM_TOKEN` — an npm **Automation** token (bypasses 2FA) |
| PyPI (`opensolvency`) | `PUBLISH_PYPI=true` | `PYPI_API_TOKEN` (or configure PyPI trusted publishing) |
| crates.io (`opensolvency`) | `PUBLISH_CRATES=true` | `CARGO_REGISTRY_TOKEN` |

With a variable unset, that job is skipped — so the workflow is safe to land before
any token exists.

## Cutting a release

1. Bump the version in each package you're releasing:
   - `package.json` + `src/version.ts` (npm main), `opensolvency-mcp/package.json`
   - `clients/python/pyproject.toml`, `clients/rust/Cargo.toml`
2. Update `CHANGELOG.md`.
3. Commit, then tag and push:
   ```bash
   git tag v0.1.1 && git push origin v0.1.1
   ```
   The tag triggers `release.yml`; each enabled registry publishes. (Or run the
   workflow manually from the Actions tab via *workflow_dispatch*.)

npm publishes with `--provenance`, so each release carries a signed attestation that
it was built from this repo + commit.

## Go (no registry — git is the registry)

The Go client is consumed straight from the repo, so "publishing" is just a tag in
the **subdirectory module** form Go expects:

```bash
git tag clients/go/v0.1.1 && git push origin clients/go/v0.1.1
```

Consumers then `go get github.com/general-liquidity/opensolvency/clients/go@v0.1.1`.

## C / C++

No central registry. Distributed as source (`clients/c/opensolvency.{c,h}`), vendored
into a build or packaged via vcpkg / Conan downstream. The release is the git tag.

## Name availability (check before the first publish)

The npm names are owned by the `general-liquidity` org. Verify the others are free
before enabling their jobs: `pip index versions opensolvency` (PyPI) and
`cargo search opensolvency` (crates.io). If taken, scope/rename in the manifest.
