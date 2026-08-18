# Delivery plan

## Scope

Build the five required pipeline stages only: Style, Characters, Portraits, Chapters, and Illustrations. The interface follows the supplied Gradion demo's information architecture while replacing its browser-only mock state with a server-backed implementation.

## Architecture

- React + Vite frontend, served locally in development.
- Express API owns identity, storage, pipeline ordering, locks, errors, and stale-run recovery.
- Each user and project has its own JSON file under `data/users/`; text and generated images live beside the project JSON.
- Gemini is accessed through the official JavaScript SDK and its Interactions API. The book is uploaded once, then the text steps chain interaction IDs.
- The browser polls while a stage is running. Image stages persist after every image so completed portraits or illustrations appear before the full step ends.

## Validation plan

- Backend tests exercise order validation, duplicate prevention, retry, stale recovery, and per-image persistence through a fake Gemini gateway.
- Frontend tests cover empty, error, and active-step states.
- Manual UAT uses a real Gemini key after the automated suite is green.
