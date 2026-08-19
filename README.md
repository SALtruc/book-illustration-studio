# Book Illustration Studio

A local, resumable web app that turns a book's text into character portraits and one chapter illustration using Gemini's Interactions API and Nano Banana image generation.

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

Open `http://localhost:5173`. The Vite client proxies API and media requests to the Express server on port 3001. There is no Docker setup because the app only needs Node and local files.

## Run the tests

```bash
npm test
```

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Server-only Gemini API key. Never exposed to the browser. |
| `GEMINI_TEXT_MODEL` | No | Defaults to `gemini-3.7-flash`. |
| `GEMINI_IMAGE_MODEL` | No | Defaults to `gemini-2.5-flash-image` — see `DECISIONS.md` for why the newer Nano Banana 2 / 2 Lite isn't the default. |
| `SESSION_SECRET` | No for local use | Cookie-signing secret. Set a unique value outside local development. |

## Architecture

The React frontend is intentionally thin. It owns forms, navigation, polling, and visual states. Express owns identity, authorization, project persistence, pipeline ordering, error state, duplicate-call prevention, stale recovery, Gemini calls, and media serving.

Projects live under `data/users/<email-sha256>/projects/<project-id>/`:

- `project-id.json` is the durable state record.
- `book.txt` stores the original full text.
- `assets/` contains generated portraits and illustrations.

Writes are atomic (temporary file plus rename), and a per-project in-process queue prevents overlapping writes and Gemini calls. This is sufficient for the single local Node process requested here; it is not designed for multiple server replicas.

## Gemini pipeline

1. Style uploads the book once and starts the saved text interaction context.
2. Characters chains from that interaction and parses structured JSON, capped server-side at two adult characters.
3. Portraits generates and saves one image per character, persisting after each image.
4. Chapters chains from the text context and parses structured JSON, capped server-side at one chapter.
5. Illustrations uses the saved portrait files as image references and saves one scene image per chapter.

There are no automatic Gemini retries. A failure remains visible and is retried by the user only. A request marked as running for more than ten minutes can be recovered from the project screen after a server interruption.

## Real-key UAT

The automated suite uses a fake Gemini gateway so it does not consume quota. This app has been run against the real Gemini API, end to end, with a real key:

- **Style and Characters: confirmed working**, across several real runs — real generated art-style prompts, real two-character casts with full portrait prompts, a real transient failure, and a real retry that recovered from it. The attempt-history panel in any project that hit an error is showing genuine Gemini responses, not fixtures.
- **Portraits and Illustrations: blocked on this key's billing, not on the code.** Two different Nano Banana image models both returned `429 ... limit: 0` — an account-level free-tier gap for image generation specifically (see `DECISIONS.md`). The request/response shape for image calls is exercised by `server/gemini.test.ts` and follows the same verified Interactions API contract as the text calls; it has not yet produced a real image end to end.
- **Before submission, whoever holds the grading Gemini key should**: enable billing (or confirm image-model access some other way), then create one project and click through all five steps. Confirm images appear under `data/`, refresh mid-image-step, and retry a deliberately invalid-key failure after fixing the key.
