# Testing strategy and report

## What is tested

Backend tests exercise the state-machine behavior that protects quota and makes the app resumable:

- Only the next ordered stage can run.
- A second request while a stage is active is rejected.
- Character and chapter caps remain enforced after structured model output.
- Portrait and illustration results persist one item at a time.
- A failed stage leaves prior work intact and can be retried, and each attempt (success or failure) is recorded in per-stage history.
- A stale running stage becomes recoverable, while an active one does not, and recovery itself is recorded as a failed attempt.
- A project saved before attempt history existed loads with an empty history instead of crashing.

The `GeminiGateway` interface is faked for these tests (`server/pipeline.test.ts`). This makes the state tests fast, deterministic, and free of Gemini quota — but a fake at that boundary can't catch the pipeline sending the wrong request shape or misreading the response, since it never touches `server/gemini.ts` at all. That gap is exactly what let an early version ship with a request/response shape that didn't match the real Interactions API (see `DECISIONS.md`).

`server/gemini.test.ts` covers that boundary instead: it mocks only the `@google/genai` SDK client (`interactions.create`, `files.upload`) and asserts on the actual wire shape — structured output and images read from `output_text`/`output_image` (the SDK-computed convenience fields on a v2 `Interaction`), a typed `response_format` per call, and `mime_type` (not `mimeType`) on inline image parts. It does not call the real API, so it still costs no quota. It has since been confirmed against the real API too — see `DECISIONS.md` and the README's real-key UAT notes.

Frontend tests cover two high-value visual states: the project-list empty state has a clear action, and a failed in-progress project communicates both its retry state and completed-stage count. The production UI also has manual coverage for identity validation, new project validation, active polling, full-text disclosure, sign-out, and responsive stepper behavior.

`server/paths.test.ts` covers the path-traversal guard on `:id`/`:file` route params (`server/paths.ts`) — confirmed live against the running server first (a crafted request read this repo's own `package.json`), then locked down with a unit test asserting the exact decoded values a URL-encoded `../` payload produces are rejected, not just a stylized example. See `DECISIONS.md`.

## What is deliberately not tested

I did not snapshot all markup or test every CSS declaration. That would make the suite brittle without increasing confidence in the pipeline. I also did not wire a real Gemini call into the automated suite: it would require secrets, vary by model output, consume quota, and run in CI where nobody is watching it burn a real image budget. `server/gemini.test.ts` closes the request/response-shape gap without spending quota; a separate real-key run (outside the test suite, driving the actual running app) is what confirmed the shape holds in practice — see `DECISIONS.md` and the README's real-key UAT section for exactly what that run did and did not prove.

Test isolation is also worth naming here rather than assuming it: `server/storage.ts` used to resolve its data directory unconditionally to `<cwd>/data`, the same folder a real running server writes to, and this suite's cleanup deleted it — including a real project mid-UAT. Tests now construct `Storage` with an isolated `os.tmpdir()` root instead, so `npm test` can no longer touch real project data no matter what else is running.

`npm test` was also intermittently flaky (~40% failure rate under load) before this suite was stable — not a bad assertion, a genuine Windows file-write race in `Storage`'s atomic save (`EPERM` on `rename` when a concurrent read holds the file). Reproduced with debug logging under a 30-run stress loop, fixed with a short retry on the transient error codes, then confirmed at 0 failures across 45+ stress runs. See `DECISIONS.md` for the full trace. Worth naming here specifically: a test suite that's green on the first try but flaky under load would have shipped this invisibly.

## Real test report

Run on 2026-08-20 with Node v22.19.0, after the Windows file-write race above was fixed and stress-tested (30 consecutive `pipeline.test.ts` runs, then 15 full `npm test` runs, 0 failures):

```text
> book-illustration-studio@0.1.0 test
> vitest run

✓ server/paths.test.ts (2 tests) 3ms
✓ server/gemini.test.ts (5 tests) 9ms
✓ client/App.test.tsx (2 tests) 91ms
✓ server/pipeline.test.ts (4 tests) 337ms

Test Files  4 passed (4)
Tests       13 passed (13)
```
