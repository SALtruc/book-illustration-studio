import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Project, User } from "./types.js";

const ROOT = path.resolve(process.cwd(), "data", "users");
const locks = new Map<string, Promise<void>>();

function userDir(email: string) {
  return path.join(ROOT, createHash("sha256").update(email.toLowerCase()).digest("hex"));
}
function projectsDir(email: string) { return path.join(userDir(email), "projects"); }
function projectFile(email: string, id: string) { return path.join(projectsDir(email), `${id}.json`); }

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await rename(temporary, file);
}
async function readJson<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export class Storage {
  async getOrCreateUser(name: string, email: string): Promise<User> {
    const normalized = email.toLowerCase();
    const file = path.join(userDir(normalized), "user.json");
    const existing = await readJson<User>(file);
    const user = existing ? { ...existing, name } : { id: randomUUID(), name, email: normalized, createdAt: new Date().toISOString() };
    await writeJson(file, user);
    return user;
  }
  async getUser(email: string) { return readJson<User>(path.join(userDir(email), "user.json")); }
  async listProjects(email: string) {
    const { readdir } = await import("node:fs/promises");
    try {
      const files = await readdir(projectsDir(email));
      const projects = await Promise.all(files.filter((file) => file.endsWith(".json")).map((file) => readJson<Project>(path.join(projectsDir(email), file))));
      return projects.filter((project): project is Project => Boolean(project)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  async getProject(email: string, id: string) { return readJson<Project>(projectFile(email, id)); }
  async saveProject(email: string, project: Project) { await writeJson(projectFile(email, project.id), project); }
  projectBookPath(email: string, id: string) { return path.join(projectsDir(email), id, "book.txt"); }
  projectAssetPath(email: string, id: string, name: string) { return path.join(projectsDir(email), id, "assets", name); }
  async writeBook(email: string, id: string, text: string) {
    const file = this.projectBookPath(email, id);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text, "utf8");
    return file;
  }
  async writeAsset(email: string, id: string, name: string, bytes: Buffer) {
    const file = this.projectAssetPath(email, id, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    return file;
  }
  async withProjectLock<T>(projectId: string, work: () => Promise<T>): Promise<T> {
    const prior = locks.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    locks.set(projectId, prior.then(() => gate));
    await prior;
    try { return await work(); } finally {
      release();
      if (locks.get(projectId) === gate) locks.delete(projectId);
    }
  }
}
