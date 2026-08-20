# Decisions

## Local JSON storage, not a database

Codex suggested SQLite first, since that's the default answer for "project state." I went with one JSON file per project instead, since I figured that would actually fit this scope better. This is local and single-process, and the records are small enough that a reviewer can just open a file and read it directly, which I liked. Codex was right that raw JSON writes can corrupt or race, though, so I had it use atomic writes (temp file plus rename) and a per-project queue. Cost: no multi-replica support, no cross-project transactions. I think that's fine at this scope.

## Separate `status` from `stepState`

Codex wanted one status enum. I pushed back on that, because I figured if someone reopens the project mid-Portraits, the page needs to say both "Characters is done" and "Portraits is running" at the same time, and one enum just can't do that. So `status` tracks the last completed step, while `stepState`, `activeStep`, and `stepStartedAt` track whatever's currently active or failed. That costs a few extra fields to keep in sync, but I think it's worth it, since resume, failure, and progress all read unambiguously as a result.

## Don't call Gemini directly from the request

The first draft returned the Gemini response straight from the button click. I didn't love that, so I changed it. Now the API persists `RUNNING` first, returns 202 immediately, and the browser polls from there. That way a second click or a second tab just sees the stored state instead of triggering a second call. The trade-off is polling instead of a websocket, which I think is fine for a small local app, and it still lets each image show up as soon as it's generated.

## Manual retry only, no auto-retry

Codex proposed exponential retry on image calls. I overrode that one pretty quickly, since the brief is explicit that retries should be user-triggered only, and I could see auto-retry on image calls quietly multiplying cost without anyone noticing. So a failure just marks the stage `FAILED`, keeps everything already generated, and shows one retry button. Cost: the user has to actually come back and click retry themselves after a transient failure.

## Book text sent to Gemini once, chained after that

The notebook uploads the book as a file and chains interaction IDs for every text prompt after that, so I kept the same approach instead of re-sending the book on every step, since that felt like the obvious call. Portraits get saved to disk and passed back in as reference images for the final illustration call. Characters and chapters also get sliced to 2 and 1 server-side even if the model returns more, so a client can't just ask for more and get it. Cost: less story coverage, but honestly that's kind of the whole point, since it's what actually bounds the cost.

## No component library

Codex suggested pulling one in for cards and dialogs. I figured I'd rather keep plain HTML elements and a small CSS file instead, since the app doesn't really need modals or menus, and a library would just be dead weight here. Cost: fewer prebuilt pieces to reach for if the app grows past this scope.

## Codex's Gemini request/response shape was made up, not checked

Codex's first version of `server/gemini.ts` compiled fine and passed the mocked tests. Before spending any quota on it, though, I wanted to check it against the actual `@google/genai` package sitting in `node_modules`, and I'm glad I did, because it didn't match at all. The code read `interaction.output_text`/`output_image`, fields that don't exist anywhere in that SDK's types. It also invented its own `response_format` object instead of using the real fields, and had `mimeType` where the SDK actually wants `mime_type`. All of it compiled cleanly only because the whole thing was cast with `as never`, which just turns off the type checker. Honestly, that cast alone should have told me to double check before trusting any of it. As written, every real Gemini call would have failed on the first request, and in fact nobody had run it even once yet, since `data/` didn't exist.

I had `gemini.ts` rewritten against the real types and added `gemini.test.ts`, which mocks the SDK client directly instead of mocking the whole gateway, so I think this kind of bug can't hide behind a green test suite again.

Separately, `gemini-3.7-flash` and `gemini-3.1-flash-lite-image` looked made up to me too at first, since version 3.7 with nothing between 3.2 and 3.6 felt like a hallucinated number. I checked Google's docs and did a search before touching either one, though, and it turned out both are real, current model names, so I left them alone. I think this is worth writing down, because it's the same instinct that caught the real bug above, and this time it would have been wrong. So I guess "looks fake" isn't proof either way on its own, and I checked instead of just guessing both times.

**Then I actually ran it with a real key**, and it turned out the type check above was necessary but not enough on its own. The first real call to Style came back with `400 The legacy Interactions API schema is no longer supported`. The installed SDK version (`1.52.0`, satisfying the `^1.30.0` in package.json) had internally consistent types, just for a schema the live API had already retired. Upgrading to `@google/genai@2.17.1` and rereading its types turned up a real surprise: v2 actually brings back `output_text`/`output_image` as convenience fields, which as it happens is closer to Codex's *original* code than my "fixed" version was. So I think the real bug was actually smaller than I first reported: one wrong field name, not the whole response shape. I only found that out by testing against the live API, not by reading types more carefully a second time, and I think that's the real lesson here. A more careful audit of the wrong SDK version would have just confirmed the wrong answer with more confidence.

A second real call surfaced an unrelated real bug too: `image/png` isn't accepted, only `image/jpeg`. One-line fix, and honestly only findable by actually calling the endpoint.

## Image model: still blocked on this key's billing

The default was Nano Banana 2 Lite (`gemini-3.1-flash-lite-image`). A real call came back `429 ... limit: 0`. As it turns out, Nano Banana 2 has no free-tier image quota at all, on any key. So I switched the default to `gemini-2.5-flash-image`, the older Nano Banana, figuring that would have an actual free allowance, and got `limit: 0` again anyway. Two different image models, same zero, same key, so I think that's this account, not the model choice. Text calls do have real quota, since a later 429 there was a normal rate limit rather than a zero. I'm leaving the default at `gemini-2.5-flash-image`, since I still think it's the right call once billing is on, and I'd rather record this as an open item than guess at a third model name against the same unbilled account.

## `npm test` deleted a real project because it shared the live data folder

`Storage` resolved its data directory to `<cwd>/data` no matter what, and the test suite's cleanup did `rm("data", { recursive: true, force: true })` on that same folder, which happens to be exactly what a running `npm start` writes real projects to. So running the tests while the app was up, which is exactly what the README tells a reviewer to do, deleted a real UAT project mid-session, including two failed Portraits attempts that had cost real quota to produce. I found this by actually running the app and the tests at the same time, not by reading the code, which I think says something about why this kind of thing slips through review. Fixed by making `Storage`'s root a constructor argument, so tests now use an isolated `os.tmpdir()` folder instead of touching the real one.

## Path traversal in the media route: any signed-in user could read arbitrary files

`GET /media/:id/assets/:file` built a file path straight from the URL with no validation, then served it with `res.sendFile`. I tried `GET /media/x/assets/..%2f..%2f..%2f..%2f..%2f..%2fpackage.json` with a valid session cookie and got this repo's real `package.json` back, which honestly wasn't what I expected going in. That's confirmed against the running server, not guessed from reading the code. `.env` itself came back 404, but only by accident: Express's `send` library ignores dotfiles by default, and the filesystem check right before it had already succeeded on that same traversed path, so the traversal itself really did reach `.env`. Anything not starting with a dot, another user's project file for instance, had no protection at all.

I think this is the same category of bug as the Gemini one, really: reasonable-looking code that was never checked against an actual request. Fixed with an `app.param` validator (`server/paths.ts`) that rejects anything that isn't a single literal path segment, then checked again afterward with the same curl request, which now returns 400 instead of file contents. There's also a unit test on the exact decoded values a URL-encoded `../` produces. This wasn't something the brief asked for directly. I went looking anyway, because I figured "does it work end to end" should include "does it leak arbitrary files when it works."

## A flaky test was a real Windows file-write race, not a bad assertion

`npm test` failed intermittently, maybe 2 in 5 runs when the machine was busy, always the same test, always one step behind where it should be. It would have been easy to just write that off as "eh, rerun it." I didn't want to do that, though, so I added debug logging and stress-ran it until it actually failed with a real stack trace: `EPERM: operation not permitted, rename ...`, thrown from the atomic-write helper, inside the Portraits loop. Windows can apparently hold a file handle just long enough, whether that's antivirus scanning or a concurrent read of the same file (which is exactly what a client polling mid-step does), that a plain `rename()` throws. I remembered that popular atomic-write libraries retry for this exact reason, so I added the same thing here: a short retry on `EPERM`, `EBUSY`, and `EACCES` in the write helper. Stress-tested at 30 runs, then 30 more, then 15 full `npm test` runs, and got zero failures after the fix, versus roughly 40% before it. I want to be clear this wasn't a mocked-gateway artifact either. It's a real concurrent-write race that could hit an actual user with two tabs open on Windows, and I think it would have shipped completely invisibly, since a single normal `npm test` run has decent odds of not hitting it at all. The 40% only showed up because this machine happened to be unusually busy from everything else going on in the same session.

## If I had one more day

The SDK-shape tests cover the request and response mapping, and real-key runs through Style and Characters, including a transient failure and a successful retry, confirm it holds up in practice and not just in a mock, which I'm fairly happy with. Attempt history per stage shipped instead of staying on this list. What's left: I still want one full real run through Portraits, Chapters, and Illustrations once billing is on for the grading key, and after that, I'd like a batch mode to run more than one project without a human clicking every single step.
