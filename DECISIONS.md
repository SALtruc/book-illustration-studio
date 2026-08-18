# Decisions

## Local JSON storage, not a database

Codex initially suggested SQLite because it is a familiar default for project state. I chose one JSON record per project instead. The assessment explicitly keeps this local and single-process, and project records are small, naturally isolated, and easy for a reviewer to inspect. Codex correctly pushed back that raw JSON writes could corrupt state or race, so the implementation uses atomic temporary-file renames and a per-project queue. The cost is that this does not support multiple app replicas or transactional cross-project operations.

## Separate completed status from active step state

Codex proposed tracking only the current stage. I rejected that because a page reopened during Portraits needs to say both that Characters succeeded and that Portraits is in flight. `status` therefore records the last completed milestone, while `stepState`, `activeStep`, and `stepStartedAt` record the active or failed request. This costs a few fields and invariants, but makes resume, failure, and project-list progress unambiguous.

## Start remote work only after persisting RUNNING

The first generated backend sketch returned a Gemini response directly from the button request. I changed that approach. The API persists `RUNNING` before launching work, returns `202`, and the browser polls the stored project state. A second click or browser tab sees the stored state and receives no second Gemini call. The trade-off is polling rather than a WebSocket, but polling is enough for this small local app and still lets each image appear independently.

## Manual retry only

Codex proposed exponential retry around image calls, which would improve transient failures but can quietly multiply image cost. I overrode it because the brief expressly requires user-triggered retries only. Errors mark the current stage `FAILED`, preserve prior output, and leave a single retry action. The cost is a user must return and click retry after a temporary service failure.

## Gemini interaction chaining and hard caps

The notebook makes the book a File API upload and chains interaction IDs for text prompts. I kept that mechanism rather than sending the book contents on every request. Portraits are saved locally and attached as reference images to the final scene call. The app slices structured output on the server to two adult characters and one chapter even if a model returns more. That avoids a client-side bypass and bounds image cost, at the expense of intentionally limited story coverage.

## Small purpose-built UI over a component library

Codex suggested adding a component library for dialogs and cards. I kept native, semantic controls and a small CSS token layer because the interaction surface is compact and no complex modal or menu primitive is necessary. The supplied Gradion warm-orange system remains recognizable, while loading, empty, failure, keyboard focus, mobile collapse, and reduced-motion states are explicit. The cost is fewer prebuilt primitives if the app grows.

## If I had one more day

I would add an integration test with a recorded Gemini-compatible response and a small attempt history per stage. That would provide stronger evidence for the real HTTP mapping and make retried generations auditable without increasing the core product scope.
