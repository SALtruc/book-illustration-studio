import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { GeminiGateway, GeneratedImage } from "./gemini.js";
import { Storage } from "./storage.js";
import { completedStatusFor, nextStep, type Project, type StepKey } from "./types.js";

const STALE_AFTER_MS = 10 * 60 * 1000;

export class PipelineError extends Error {
  constructor(message: string, public readonly statusCode = 400) { super(message); }
}

export class Pipeline {
  constructor(private storage: Storage, private gatewayFactory: () => GeminiGateway) {}

  async run(email: string, projectId: string, requested: StepKey, suppliedStyle?: string) {
    return this.storage.withProjectLock(projectId, async () => {
      const project = await this.mustGet(email, projectId);
      if (project.stepState === "RUNNING") throw new PipelineError(`The ${project.activeStep?.toLowerCase()} step is already running.`, 409);
      if (nextStep(project.status) !== requested) throw new PipelineError(`The next available step is ${nextStep(project.status) ?? "none"}.`, 409);
      project.stepState = "RUNNING";
      project.activeStep = requested;
      project.stepStartedAt = new Date().toISOString();
      project.lastError = undefined;
      await this.storage.saveProject(email, project);
      void this.execute(email, project, requested, suppliedStyle);
      return project;
    });
  }

  async recover(email: string, projectId: string) {
    return this.storage.withProjectLock(projectId, async () => {
      const project = await this.mustGet(email, projectId);
      const startedAt = project.stepStartedAt ? Date.parse(project.stepStartedAt) : 0;
      if (project.stepState !== "RUNNING" || Date.now() - startedAt < STALE_AFTER_MS) throw new PipelineError("This step is still active and cannot be recovered yet.", 409);
      project.stepState = "FAILED";
      project.lastError = "The server stopped before this request completed. You can retry this step.";
      if (project.activeStep) this.recordAttempt(project, project.activeStep, project.stepStartedAt!, "FAILED", project.lastError);
      await this.storage.saveProject(email, project);
      return project;
    });
  }

  private recordAttempt(project: Project, step: StepKey, startedAt: string, outcome: "DONE" | "FAILED", error?: string) {
    const attempt = project.history.filter((entry) => entry.step === step).length + 1;
    project.history.push({ step, attempt, startedAt, endedAt: new Date().toISOString(), outcome, ...(error ? { error } : {}) });
  }

  private async execute(email: string, project: Project, step: StepKey, suppliedStyle?: string) {
    const startedAt = project.stepStartedAt ?? new Date().toISOString();
    try {
      const gateway = this.gatewayFactory();
      if (step === "STYLE") await this.style(email, project, gateway, suppliedStyle);
      if (step === "CHARACTERS") await this.characters(email, project, gateway);
      if (step === "PORTRAITS") await this.portraits(email, project, gateway);
      if (step === "CHAPTERS") await this.chapters(email, project, gateway);
      if (step === "ILLUSTRATIONS") await this.illustrations(email, project, gateway);
      project.status = completedStatusFor[step];
      project.stepState = "IDLE";
      project.activeStep = undefined;
      project.stepStartedAt = undefined;
      this.recordAttempt(project, step, startedAt, "DONE");
      await this.storage.saveProject(email, project);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The generation failed. Retry when you are ready.";
      project.stepState = "FAILED";
      project.lastError = message;
      this.recordAttempt(project, step, startedAt, "FAILED", message);
      await this.storage.saveProject(email, project);
    }
  }

  private async style(email: string, project: Project, gateway: GeminiGateway, suppliedStyle?: string) {
    if (!project.gemini?.bookInteractionId) {
      const context = await gateway.beginBook(project.bookPath);
      project.gemini = { fileUri: context.fileUri, bookInteractionId: context.interactionId };
      await this.storage.saveProject(email, project);
    }
    const result = await gateway.setStyle(project.gemini!.bookInteractionId!, suppliedStyle);
    project.style = result.style;
    project.gemini!.lastTextInteractionId = result.interactionId;
  }
  private async characters(email: string, project: Project, gateway: GeminiGateway) {
    const result = await gateway.generateCharacters(project.gemini!.lastTextInteractionId!);
    project.characters = result.characters.slice(0, 2);
    project.gemini!.lastTextInteractionId = result.interactionId;
  }
  private async portraits(email: string, project: Project, gateway: GeminiGateway) {
    let context = await gateway.portraitContext(project.style!);
    for (let index = 0; index < project.characters.length; index += 1) {
      const character = project.characters[index];
      if (character.imageState === "DONE") continue;
      const result = await gateway.generatePortrait(context, character);
      context = result.interactionId;
      character.imageUrl = await this.persistImage(email, project, "portrait", index, result.image);
      character.imageState = "DONE";
      await this.storage.saveProject(email, project);
    }
  }
  private async chapters(_email: string, project: Project, gateway: GeminiGateway) {
    const result = await gateway.generateChapters(project.gemini!.lastTextInteractionId!);
    project.chapters = result.chapters.slice(0, 1);
    project.gemini!.lastTextInteractionId = result.interactionId;
  }
  private async illustrations(email: string, project: Project, gateway: GeminiGateway) {
    let context = await gateway.illustrationContext(project.style!);
    const portraits: GeneratedImage[] = [];
    for (const character of project.characters) {
      if (character.imageUrl) portraits.push({ bytes: await readFile(this.storage.projectAssetPath(email, project.id, path.basename(character.imageUrl))), extension: character.imageUrl.endsWith(".jpg") ? "jpg" : "png" });
    }
    for (let index = 0; index < project.chapters.length; index += 1) {
      const chapter = project.chapters[index];
      if (chapter.imageState === "DONE") continue;
      const result = await gateway.generateIllustration(context, chapter, portraits);
      context = result.interactionId;
      chapter.imageUrl = await this.persistImage(email, project, "illustration", index, result.image);
      chapter.imageState = "DONE";
      await this.storage.saveProject(email, project);
    }
  }
  private async persistImage(email: string, project: Project, kind: string, index: number, image: GeneratedImage) {
    const fileName = `${kind}-${index + 1}.${image.extension}`;
    await this.storage.writeAsset(email, project.id, fileName, image.bytes);
    return `/media/${project.id}/assets/${fileName}`;
  }
  private async mustGet(email: string, projectId: string) {
    const project = await this.storage.getProject(email, projectId);
    if (!project) throw new PipelineError("Project not found.", 404);
    return project;
  }
}

export function newProject(userId: string, title: string, bookPath: string, bookText: string): Project {
  return { id: randomUUID(), userId, title, createdAt: new Date().toISOString(), status: "CREATED", stepState: "IDLE", bookPath, bookPreview: bookText.slice(0, 260), characters: [], chapters: [], history: [] };
}
