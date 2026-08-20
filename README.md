# Book Illustration Studio

A local, resumable web app that turns a book's text into character portraits and one chapter illustration, using Gemini's Interactions API for text and Nano Banana models for image generation. Built for the Gradion intern take-home assessment, following the five-step pipeline from Google's "Illustrate a book: The Wind in the Willows" notebook.

What it does, in short:

- Email + name identity, no password. Returning with the same email loads that user's existing projects.
- Create a project from pasted or uploaded book text.
- Run the pipeline one step at a time, in order: **Style → Characters → Portraits → Chapters → Illustrations**.
- Refresh, close the tab, or restart the server mid-step and the project picks up exactly where it left off. No duplicate Gemini calls, no lost progress.
- Every attempt, successful or failed, is recorded per step and shown in the UI, not just the most recent one.
- A failed step shows the real error and a retry button. A step stuck "running" past ten minutes (server died mid-call) can be recovered from the project screen.

## Prerequisites

- Node.js 22 or newer
- A Gemini API key with access to the configured text and image models

## Run locally

```bash
copy .env.example .env
# add GEMINI_API_KEY to .env
npm install
npm start
```

Open `http://localhost:5173`. The Vite client proxies `/api` and `/media` requests to the Express server on port 3001. There is no Docker setup, since the app only needs Node and the local filesystem, nothing else to containerize.

## Run the tests

```bash
npm test
```

See `TESTING.md` for what's covered, what's intentionally skipped, and a real test run.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Server-only Gemini API key. Never exposed to the browser. |
| `GEMINI_TEXT_MODEL` | No | Defaults to `gemini-3.7-flash`. |
| `GEMINI_IMAGE_MODEL` | No | Defaults to `gemini-2.5-flash-image`. See `DECISIONS.md` for why the newer Nano Banana 2 / 2 Lite isn't the default. |
| `SESSION_SECRET` | No for local use | Cookie-signing secret. Set a unique value outside local development. |

## Project structure

```
client/            React frontend (Vite)
  App.tsx           All screens and components: identity, project list, new project, project detail
  styles.css        Design tokens and layout, no framework
server/
  index.ts          Express routes, session cookie, request validation
  pipeline.ts        Step ordering, resumability, retry, attempt history
  gemini.ts          Talks to the real Gemini Interactions API
  storage.ts         Atomic JSON persistence, per-project write locking
  paths.ts           Guards route params used to build filesystem paths
docs/plan.md         Delivery plan written before implementation
AGENTS.md            Project context for the AI coding tool
DECISIONS.md         Design decisions, trade-offs, and where AI output was wrong
TESTING.md           Test strategy and a real test report
```

## Architecture

The React frontend is intentionally thin. It owns forms, navigation, polling, and visual states, and holds no business logic of its own. Express owns everything that matters for correctness: identity, authorization, project persistence, pipeline ordering, error state, duplicate-call prevention, stale-step recovery, the Gemini calls themselves, and serving generated media back to the browser.

Identity is a signed cookie, not a session store. The server HMAC-signs the user's email with `SESSION_SECRET`; the cookie carries the email plus that signature, and the server just re-verifies the signature on each request instead of tracking sessions anywhere. No password, matching the brief.

Projects live under `data/users/<email-sha256>/projects/<project-id>/`:

- `project-id.json` is the durable state record: status, current step, style, characters, chapters, and the full attempt history.
- `book.txt` stores the original full text.
- `assets/` holds the generated portraits and illustrations.

Writes are atomic (temp file, then rename), and a per-project in-process lock queues overlapping writes and Gemini calls so a double-click or a second tab can't fire the same step twice. That's sufficient for the single local Node process this assessment asks for; it isn't designed for multiple server replicas, and `DECISIONS.md` says so directly.

Route parameters that get turned into filesystem paths (`:id`, `:file`) are validated before any handler runs, since an unvalidated one used to let a signed-in user read arbitrary files on disk through the media route. See `DECISIONS.md` for how that was found and fixed.

## Gemini pipeline

1. **Style** uploads the book once and starts the saved text interaction context. An optional user-supplied style is kept as-is; otherwise Gemini picks one.
2. **Characters** chains from that interaction and parses structured JSON, capped server-side at two adult characters even if the model returns more.
3. **Portraits** generates and saves one image per character, persisting to disk after each image so completed portraits show up before the whole step finishes.
4. **Chapters** chains from the text context and parses structured JSON, capped server-side at one chapter.
5. **Illustrations** reuses the saved portrait images as references so the final scene stays visually consistent with the characters, and saves one scene image per chapter.

There are no automatic Gemini retries anywhere in this pipeline. A failure marks the step `FAILED`, keeps everything already generated, and is retried by the user only.

## Real-key UAT

**All five steps are implemented and wired end to end**: same code path, same Interactions API contract, same request/response shapes for text and image calls (`server/gemini.test.ts` covers both). What differs between them is how far real-key verification actually got, limited by this development key's free-tier quota, not by any gap in the implementation:

- **Style and Characters: verified working against the live API**, across several real runs. Real generated art-style prompts, real two-character casts with full portrait prompts, a real transient failure, and a real retry that recovered from it. The attempt-history panel in any project that hit an error is showing genuine Gemini responses, not fixtures.
- **Portraits, Chapters, Illustrations: implemented and unit-tested, not yet confirmed with a real generated image.** This development key's free tier has no image-generation quota at all, confirmed on two different Nano Banana models (see `DECISIONS.md`), and separately hit its daily text-request cap from the volume of UAT runs during development. Neither is a code issue; both are exactly the kind of account-level limit §5.3 asks to check for up front.
- **Before submission, whoever holds the grading Gemini key should**: enable billing (or otherwise confirm image-model quota), then create one project and click through all five steps. Confirm images appear under `data/`, refresh mid-image-step, and retry a deliberately invalid-key failure after fixing the key. Everything up to that point, order enforcement, resumability, duplicate-call prevention, retry, stale recovery, is already proven, by tests and by the real runs above.
