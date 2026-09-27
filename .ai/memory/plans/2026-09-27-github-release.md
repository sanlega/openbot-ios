# Plan: Prepare the first downloadable GitHub release

- **Date**: 2026-09-27 · **Author**: codex · **Status**: in progress
- **Request**: “polishear un poco el repo de github ... mergear a main la ultima version ... añadir la releases para que aparezan en releases, los descargables digo, y demás”

## Objective

Integrate the current OpenBot work into `main` and give users a clear way to download installable desktop builds from GitHub Releases for macOS, Windows, and Linux.

## Scope

**Includes**
- Review the current branch and its CI; create a PR if none exists.
- Add user-facing release notes and an automated cross-platform packaging/release workflow.
- Update README download instructions to point at actual Release assets.
- Prepare the first release as `v0.1.0`, matching all current package manifests and with no existing tags/releases.
- After final release confirmation, make the repository public (user requested), merge the PR, push the annotated tag, and verify the published assets.

**Outside scope**
- Code signing/notarization; this repository has no signing credentials configured and existing packaging is explicitly unsigned.
- Publishing packages to npm or publishing a Docker image.
- Making other product or architecture changes unrelated to release readiness.

## Acceptance criteria

1. The current feature branch has a reviewable PR to `main`; CI is green on its exact head before merge.
2. The release workflow builds a macOS DMG, Windows installers, Linux AppImage and `.deb`, plus SHA-256 checksums, and attaches them to the matching GitHub Release.
3. The changelog describes user-visible `v0.1.0` changes and README download links point to actual Releases.
4. The Mac package is built and smoke-tested locally; cross-platform artifact builds and Linux package smoke pass in GitHub Actions.
5. Repository visibility, history rewrite, merge, tag, and public Release are performed only after presenting the prepared PR, version, artifacts, checks, and rollback route for final approval.

## Design

- **Components**: `.github/workflows`, `CHANGELOG.md`, `README.md`, desktop package output, `.ai/memory`.
- **Data/contracts**: no runtime API or database changes.
- **Flow**: PR CI validates the merged feature set; a version tag starts four native runner builds (macOS arm64 + x64 separately, Windows x64, Linux x64); each uploads installable assets; a least-privilege Ubuntu job combines assets, generates SHA-256 checksums, and creates the GitHub Release with the changelog.
- **Failure handling**: if any matrix build fails, no Release is created. Before publication, the release tag can be omitted; after publication, use a new version rather than retagging. Merge can be reverted with a follow-up revert commit.
- **Compatibility**: v0.1.0 matches existing `0.1.0` package versions; no manifest bump is needed.
- **Alternatives**: attaching transient PR artifacts — rejected because workflow artifacts expire and are not listed in the Releases page; manually creating installers — rejected because it is not reproducible.

## Tasks

| # | Task | Files | Verification | Depends on | Parallel |
|---|------|-------|--------------|------------|----------|
| 1 | Review current branch, main, PR/release state, and agree release contents | current diff, status, GitHub metadata | code review, exact branch/status comparison | — | no |
| 2 | Add changelog, release workflow, and README install instructions | `.github/workflows/release.yml`, `CHANGELOG.md`, `README.md` | action syntax, YAML validation, package build, clean install smoke | 1 | no |
| 3 | Push and open PR; wait for GitHub Actions; fix failures | branch, PR | all required CI jobs green on exact head | 2 | no |
| 4 | Present release candidate and wait for explicit final approval | release summary | user confirms exact v0.1.0 merge/publication | 3 | no |
| 5 | Make repo public, merge PR, tag and verify release assets | GitHub repository, main, release tag | default branch head, visible Release, every expected asset downloadable/checksum verified | 4 | no |

Progress:
- [x] T1 reconnaissance and review: product/release state verified; all 18 branch histories scrubbed of private notes, session links, local paths, and personal metadata; PR #17 metadata cleaned. GitHub read-only PR refs 1–16 still retain historical commits and require Support purge before public visibility.
- [x] T2: README, contributor/privacy guidance, issue/PR templates, changelog, and tagged release workflow added. Local lint, format, `mh check`, build, typecheck, and tests pass; workflow YAML parses.
- [x] T3: PR #18 is open; current head is `6568bf7`. CI run 76 reports all ten jobs
  failed; the connector exposes neither job steps nor logs (`BlobNotFound`). Local full
  checks pass. Diagnose before merge; required CI must pass on the exact head.
- [ ] T4
- [ ] T5

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| One platform's native Electron packaging fails | medium | high | run platform CI before merge/tag; publish only if the full matrix passes |
| Unsigned installers trigger OS warnings | high | medium | state unsigned status on the Release and README; signing remains a later task |
| Public repository exposes all code and history | certain | high | remove personal/local material from current tree and prepare a cleaned-history rewrite before changing visibility |
| Release assets differ from CI output patterns | medium | high | validate artifact names and checksum list before `gh release create` |

## Open questions

- GitHub Support must purge old closed-PR refs/cached views before repository visibility changes. User requested public visibility; final merge/tag/release still needs the concrete release approval required by `release-manager`.
