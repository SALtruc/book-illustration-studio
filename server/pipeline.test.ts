import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pipeline, PipelineError, newProject } from "./pipeline.js";
import type { GeminiGateway } from "./gemini.js";
import { Storage } from "./storage.js";
import type { Asset, Project, StepKey } from "./types.js";

const email = "test@example.com";
const waitFor = async (check: () => Promise<boolean>) => { for (let i = 0; i < 100; i += 1) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 5)); } throw new Error("Timed out waiting for pipeline."); };

// An isolated temp directory per test, outside the repo — Storage used to default
// to <cwd>/data unconditionally, which is the same folder a locally running dev
// server writes real projects to. This suite's cleanup deleted that folder on
// every run; it once wiped a real, hand-verified UAT project. See DECISIONS.md.
let testRoot: string;
beforeEach(async () => { testRoot = await mkdtemp(path.join(tmpdir(), "book-studio-test-")); });
afterEach(async () => { await rm(testRoot, { recursive: true, force: true }); });

class FakeGemini implements GeminiGateway {
  fail = false;
  async beginBook() { return { fileUri: "files/book", interactionId: "book" }; }
  async setStyle(_previous: string, style?: string) { await new Promise((resolve) => setTimeout(resolve, 20)); if (this.fail) throw new Error("Gemini unavailable"); return { interactionId: "style", style: style || "Ink illustration" }; }
  async generateCharacters() { return { interactionId: "characters", characters: ["A", "B", "Ignored"].map((name): Asset => ({ name, prompt: `${name} prompt`, imageState: "PENDING" })) }; }
  async portraitContext() { return "portraits"; }
  async generatePortrait(previous: string) { return { interactionId: `${previous}-next`, image: { bytes: Buffer.from("portrait"), extension: "png" as const } }; }
  async generateChapters() { return { interactionId: "chapters", chapters: [{ name: "Opening", prompt: "Scene prompt", characters: ["A"], imageState: "PENDING" as const }, { name: "Ignored", prompt: "Other", characters: [], imageState: "PENDING" as const }] }; }
  async illustrationContext() { return "illustrations"; }
  async generateIllustration(previous: string) { return { interactionId: `${previous}-next`, image: { bytes: Buffer.from("scene"), extension: "png" as const } }; }
}

async function setup() {
  const storage = new Storage(testRoot); const user = await storage.getOrCreateUser("Test User", email); const project = newProject(user.id, "Test story", "test-book.txt", "A short story"); await storage.saveProject(email, project); const fake = new FakeGemini(); return { storage, project, fake, pipeline: new Pipeline(storage, () => fake) };
}
async function runAndWait(storage: Storage, pipeline: Pipeline, project: Project, step: StepKey) {
  await pipeline.run(email, project.id, step);
  await waitFor(async () => (await storage.getProject(email, project.id))?.stepState !== "RUNNING");
  return (await storage.getProject(email, project.id))!;
}

describe("Pipeline", () => {
  it("enforces order, prevents duplicate work, and persists image progress", async () => {
    const { storage, project, pipeline } = await setup();
    await pipeline.run(email, project.id, "STYLE");
    await expect(pipeline.run(email, project.id, "STYLE")).rejects.toMatchObject({ statusCode: 409 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const afterStyle = await storage.getProject(email, project.id);
    expect(afterStyle?.status, JSON.stringify(afterStyle)).toBe("STYLE_SET");
    await expect(pipeline.run(email, project.id, "PORTRAITS")).rejects.toMatchObject({ statusCode: 409 });
    await runAndWait(storage, pipeline, project, "CHARACTERS");
    let stored = await runAndWait(storage, pipeline, project, "PORTRAITS");
    expect(stored.characters).toHaveLength(2);
    expect(stored.characters.every((character) => character.imageState === "DONE" && character.imageUrl)).toBe(true);
    await runAndWait(storage, pipeline, project, "CHAPTERS");
    stored = await runAndWait(storage, pipeline, project, "ILLUSTRATIONS");
    expect(stored.status).toBe("DONE");
    expect(stored.chapters).toHaveLength(1);
    expect(stored.chapters[0].imageUrl).toContain("illustration-1.png");
    expect(stored.history.map((entry) => [entry.step, entry.attempt, entry.outcome])).toEqual([
      ["STYLE", 1, "DONE"], ["CHARACTERS", 1, "DONE"], ["PORTRAITS", 1, "DONE"], ["CHAPTERS", 1, "DONE"], ["ILLUSTRATIONS", 1, "DONE"]
    ]);
  });

  it("keeps a failed stage retryable without erasing completed work", async () => {
    const { storage, project, pipeline, fake } = await setup();
    fake.fail = true;
    await pipeline.run(email, project.id, "STYLE");
    await waitFor(async () => (await storage.getProject(email, project.id))?.stepState === "FAILED");
    expect((await storage.getProject(email, project.id))?.status).toBe("CREATED");
    fake.fail = false;
    const retried = await runAndWait(storage, pipeline, project, "STYLE");
    expect(retried.status).toBe("STYLE_SET");
    expect(retried.style).toBe("Ink illustration");
    expect(retried.history.map((entry) => [entry.step, entry.attempt, entry.outcome])).toEqual([["STYLE", 1, "FAILED"], ["STYLE", 2, "DONE"]]);
    expect(retried.history[0].error).toContain("Gemini unavailable");
  });

  it("offers recovery only for a genuinely stale in-progress stage, and records it as a failed attempt", async () => {
    const { storage, project, pipeline } = await setup();
    project.stepState = "RUNNING"; project.activeStep = "STYLE"; project.stepStartedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString(); await storage.saveProject(email, project);
    const recovered = await pipeline.recover(email, project.id);
    expect(recovered.stepState).toBe("FAILED");
    expect(recovered.lastError).toContain("server stopped");
    expect(recovered.history).toHaveLength(1);
    expect(recovered.history[0]).toMatchObject({ step: "STYLE", attempt: 1, outcome: "FAILED" });
    await expect(pipeline.recover(email, project.id)).rejects.toBeInstanceOf(PipelineError);
  });

  it("migrates a project saved before attempt history existed", async () => {
    const { storage, project, pipeline } = await setup();
    const { history, ...withoutHistory } = project;
    await storage.saveProject(email, withoutHistory as Project);
    expect((await storage.getProject(email, project.id))?.history).toEqual([]);
    const stored = await runAndWait(storage, pipeline, project, "STYLE");
    expect(stored.history).toHaveLength(1);
  });
});
