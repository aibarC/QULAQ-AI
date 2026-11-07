# Integration acceptance checklist

- [x] Workspace survives server restart; unfinished evaluations do not repeat.
- [x] DEV and upload import produce stable IDs; no fake scores appear on import.
- [x] Disabled analysis produces a clear UI explanation and zero provider calls.
- [x] Injected evaluator completes one HTTP job; UI displays its exact result, checklist, evidence, and XLSX.
- [x] N/A, scaled answers, gross violations and appeals preserve original results.
- [x] Upload errors, provider failure, timeout and repeated click do not fabricate success.
- [x] Root .env is neither inspected nor committed; external gateway remains untouched.
- [x] README describes actual verification and the remaining one-test prerequisite.

Verification: 25 frontend unit tests, 34 backend tests, production build, and two browser journeys through the real localhost HTTP stack with an injected synthetic evaluator. The normal local server imported 65 DEV dialogues and refused analysis with EVALUATION_DISABLED; no gateway call was made.
