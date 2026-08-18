# Testing strategy and report

## What is tested

Backend tests exercise the state-machine behavior that protects quota and makes the app resumable:

- Only the next ordered stage can run.
- A second request while a stage is active is rejected.
- Character and chapter caps remain enforced after structured model output.
- Portrait and illustration results persist one item at a time.
- A failed stage leaves prior work intact and can be retried.
- A stale running stage becomes recoverable, while an active one does not.

The gateway is faked for these tests. This makes the state tests fast and deterministic and avoids spending Gemini image quota.

Frontend tests cover two high-value visual states: the project-list empty state has a clear action, and a failed in-progress project communicates both its retry state and completed-stage count. The production UI also has manual coverage for identity validation, new project validation, active polling, full-text disclosure, sign-out, and responsive stepper behavior.

## What is deliberately not tested

I did not snapshot all markup or test every CSS declaration. That would make the suite brittle without increasing confidence in the pipeline. I also did not run a real Gemini image call in CI: it would require secrets, vary by model output, and consume quota. The README documents the focused real-key UAT run to perform before submission.

## Real test report

Run on 2026-08-18 with Node v22.19.0:

```text
> book-illustration-studio@0.1.0 test
> vitest run

✓ server/pipeline.test.ts (3 tests)
✓ client/App.test.tsx (2 tests)

Test Files  2 passed (2)
Tests       5 passed (5)
```
