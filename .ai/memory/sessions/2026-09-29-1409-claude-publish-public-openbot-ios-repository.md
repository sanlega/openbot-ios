# Publish public openbot-ios repository

- **Fecha**: 2026-09-29 14:09
- **Agente**: claude
- **Rama**: claude/product-polish @ 5bb7334

## Done
- Privacy audit of tracked files and full history (paths, emails, names, LAN
  IPs, device names, credential patterns, Apple team IDs): content was clean.
- Commit authors with personal emails/full name were rewritten to the GitHub
  noreply identity in a scratch clone; the local repo was not rewritten.
- Created public `sanlega/openbot-ios`, pushed `main` over SSH (the gh token
  lacks `workflow` scope). Local remote `public` added.
- Neutralized a handle in a test; README links point to the public repo.
- Checks: focused test and Prettier on the changed files passed.

## Pending
- Local `claude/product-polish` hashes differ from `public/main`; rebase new
  work onto `public/main` before pushing.
- `apps/mobile/.gitignore` / `expo-env.d.ts` Expo CLI edits remain uncommitted
  pending the owner's decision (see STATE).

## Retro
- Scanning `git log -p` once into a file and grepping it was fast and thorough.
- The stop hook re-fires on pre-existing generated edits; a documented
  "known uncommitted" allowlist in the harness would avoid repeated prompts.
