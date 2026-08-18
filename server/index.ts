import "dotenv/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { access } from "node:fs/promises";
import { GeminiClient } from "./gemini.js";
import { Pipeline, PipelineError, newProject } from "./pipeline.js";
import { Storage } from "./storage.js";
import { STEPS, type StepKey } from "./types.js";

const app = express();
const storage = new Storage();
const pipeline = new Pipeline(storage, () => new GeminiClient());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const PORT = Number(process.env.PORT || 3001);
const secret = process.env.SESSION_SECRET || "local-development-secret-change-me";

app.use(express.json({ limit: "8mb" }));

function sign(email: string) { return createHmac("sha256", secret).update(email).digest("base64url"); }
function setSession(response: Response, email: string) { response.cookie("book_studio", `${Buffer.from(email).toString("base64url")}.${sign(email)}`, { httpOnly: true, sameSite: "lax", secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }); }
function sessionEmail(request: Request) {
  const token = request.headers.cookie?.split(";").map((entry) => entry.trim()).find((entry) => entry.startsWith("book_studio="))?.slice("book_studio=".length);
  if (!token) return undefined;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return undefined;
  const email = Buffer.from(encoded, "base64url").toString();
  const expected = sign(email);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return undefined;
  return email;
}
async function requireUser(request: Request, response: Response, next: NextFunction) {
  const email = sessionEmail(request);
  if (!email || !(await storage.getUser(email))) return response.status(401).json({ error: "Sign in to continue." });
  response.locals.email = email;
  next();
}
function publicProject(project: Awaited<ReturnType<Storage["getProject"]>>) {
  if (!project) return project;
  const { bookPath, gemini, ...safe } = project;
  return safe;
}

app.post("/api/session", async (request, response) => {
  const name = String(request.body?.name || "").trim();
  const email = String(request.body?.email || "").trim().toLowerCase();
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return response.status(422).json({ error: "Enter a name and valid email address." });
  const user = await storage.getOrCreateUser(name, email);
  setSession(response, user.email);
  response.json({ user });
});
app.get("/api/session", requireUser, async (_request, response) => response.json({ user: await storage.getUser(response.locals.email) }));
app.delete("/api/session", (_request, response) => { response.clearCookie("book_studio"); response.status(204).end(); });
app.get("/api/projects", requireUser, async (_request, response) => response.json({ projects: (await storage.listProjects(response.locals.email)).map(publicProject) }));
app.post("/api/projects", requireUser, upload.single("file"), async (request, response) => {
  const title = String(request.body?.title || "").trim();
  const text = request.file ? request.file.buffer.toString("utf8") : String(request.body?.bookText || "").trim();
  if (!title || !text) return response.status(422).json({ error: "A project title and book text are required." });
  if (request.file && !request.file.originalname.toLowerCase().endsWith(".txt")) return response.status(422).json({ error: "Upload a .txt file only." });
  const user = await storage.getUser(response.locals.email);
  const provisional = newProject(user!.id, title, "", text);
  provisional.bookPath = await storage.writeBook(response.locals.email, provisional.id, text);
  await storage.saveProject(response.locals.email, provisional);
  response.status(201).json({ project: publicProject(provisional) });
});
app.get("/api/projects/:id", requireUser, async (request, response) => {
  const id = String(request.params.id);
  const project = await storage.getProject(response.locals.email, id);
  if (!project) return response.status(404).json({ error: "Project not found." });
  response.json({ project: publicProject(project), bookText: await (await import("node:fs/promises")).readFile(project.bookPath, "utf8") });
});
app.get("/media/:id/assets/:file", requireUser, async (request, response) => {
  const file = storage.projectAssetPath(response.locals.email, String(request.params.id), String(request.params.file));
  try { await access(file); response.sendFile(file); } catch { response.status(404).end(); }
});
app.post("/api/projects/:id/run/:step", requireUser, async (request, response, next) => {
  try {
    const step = String(request.params.step).toUpperCase() as StepKey;
    if (!STEPS.includes(step)) throw new PipelineError("Unknown pipeline step.");
    const project = await pipeline.run(response.locals.email, String(request.params.id), step, typeof request.body?.style === "string" ? request.body.style.trim() : undefined);
    response.status(202).json({ project: publicProject(project) });
  } catch (error) { next(error); }
});
app.post("/api/projects/:id/recover", requireUser, async (request, response, next) => {
  try { response.json({ project: publicProject(await pipeline.recover(response.locals.email, String(request.params.id))) }); } catch (error) { next(error); }
});
app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof PipelineError) return response.status(error.statusCode).json({ error: error.message });
  if (error instanceof multer.MulterError) return response.status(422).json({ error: error.message });
  console.error(error);
  response.status(500).json({ error: "Unexpected server error." });
});
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
