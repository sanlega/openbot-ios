# Lecciones

Memoria rápida de la automejora (estilo Reflexion): una línea por lección, concreta y
accionable ("antes de X, haz Y porque Z"). Se añaden con `.ai/bin/mh learn "..."`.
La skill `self-improve` las consolida en skills, contexto o protocolo y las retira de aquí.

- 2026-09-27 [unknown] Before calling a milestone done, check that each E2E assertion matches the milestone sentence; fakes-only unit tests per package do not catch broken wiring between packages (approvals, caps, chat history all passed unit tests while broken end to end).
- 2026-09-27 [unknown] Mocks of another package's API drift: run the client (e.g. packages/ui) against the real server in at least one E2E; the UI mock here disagreed with the server on WS frames, 8 response shapes, and even with the UI's own setup wizard.
- 2026-09-27 [unknown] Event bus notifications can arrive out of seq order (publish awaits an async append before notifying); never deduplicate live events by 'highest seq sent'.
