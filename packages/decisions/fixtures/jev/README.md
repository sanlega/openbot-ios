# Jev fixtures index

Sanitized request/response pairs recorded live against `https://api.typesafe.ai/v1/systemone` and `/v1/models` on 2026-09-27 during a pre-implementation spike. No API key appears in any file here — every request was made with `Authorization: Bearer $JEV_API_KEY` read from the environment at call time, never interpolated into a saved body. The one file that references an invalid key (`errors/401-invalid-key.request.json`) names a made-up placeholder string, not the real secret.

Used to seed OpenBot's fake Jev server (`packages/decisions/src/fake-jev.ts` per `.ai/memory/plans/openbot-v1.md` WS0/WS7), so `DecisionService` conformance tests don't need a real key.

| Dir | Question type | Maps to plan usage |
|---|---|---|
| `models/` | `GET /v1/models` | `DecisionService.validateKey` / setup wizard |
| `choice/` | Single `choice` | CoS delegation / spawn-gate `route` question |
| `score/` | Single `score` | Engine/model routing `complexity` question |
| `noul/` | Single `noul` | Triage `needs_engine` gate |
| `batch/` | 5 questions (`choice`+`score`+3×`noul`) in one call | Inbound-message triage bundle (report §7 row 1) |
| `computer-action/` | 2×`choice` + `noul` in one call, over indexed DOM elements | WS9 fast-loop "observe → pick op+target → verify" pattern |
| `errors/` | `422` (missing `criteria`) and `401` (bad key) | `DecisionService` fallback/error-handling paths |

Each response file is the real body Jev returned (headers stripped; see `jev-spike.md` for header shapes and latencies).
