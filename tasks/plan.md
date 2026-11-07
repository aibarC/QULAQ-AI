# MVP integration plan

Frontend snapshot 8901b9f is published in codex/frontend-interactive / PR 4.
Integration work lives in codex/backend-mvp-integration.

## Constraints

- Never inspect or print the root .env or its token. Runtime code may reference LLM_BASE_URL and LLM_API_TOKEN by name. Tests use isolated configuration and injected functions.
- No external LLM requests, model discovery, health probes, automatic retries, or warmup. Gateway execution requires a later explicit user authorization for one test. Default runtime disables evaluations.
- Preserve the frontend Workspace contract and separate source Excel preview from actual server evaluations.
- Private transcripts and local state remain ignored, outside committed sources.

## Ordered work

1. Implement loopback HTTP server and atomic local Workspace persistence; import local DEV, uploaded transcripts, checklist versions, evaluation lifecycle and appeals.
2. Implement deterministic scoring and strict model-output validation from project requirements; keep secrets and model requests server-side behind a one-use opt-in gate.
3. Connect frontend upload and analysis to the real local server; handle disabled evaluation explicitly and preserve confirmed data on errors.
4. Exercise real localhost HTTP plus browser journey with an injected synthetic evaluator in a dedicated test server. Separately verify the normal server refuses evaluation without ever invoking the provider.
5. Update run/handoff instructions, review changes, publish integration branch/PR. Report that gateway quality/compatibility remains untested until the user's one-test authorization.

## Ownership

- adapter agent: backend HTTP routes/store and associated tests.
- checklist_editor agent: backend scoring, fixed checklist, model-output contract/prompt and tests.
- root: backend configuration/provider/start scripts, frontend upload/API wiring, integration.
- review agent: independent review and end-to-end tests after interfaces stabilize.
