# Book Illustration Studio

## Product constraints

- This is a five-step user-driven Gemini pipeline. Never add automatic retries or a sixth feature stage.
- Keep the hard server-side caps: two adult characters and one chapter.
- Book text is uploaded to Gemini once. Subsequent text operations must use the saved interaction chain.
- `status` records the latest completed stage. `stepState` records whether an action is idle, running, or failed. Do not collapse them.
- Generated assets and project state must remain available after a browser refresh or server restart.

## Quality gate

Run `npm test` after changing pipeline or UI state behavior. Never place a Gemini key in source control.
