import { FormEvent, useCallback, useEffect, useState } from "react";

type StepKey = "STYLE" | "CHARACTERS" | "PORTRAITS" | "CHAPTERS" | "ILLUSTRATIONS";
type Status = "CREATED" | "STYLE_SET" | "CHARACTERS_GENERATED" | "PORTRAITS_GENERATED" | "CHAPTERS_GENERATED" | "DONE";
type Asset = { name: string; prompt: string; imageUrl?: string; imageState?: "PENDING" | "DONE"; characters?: string[] };
type Attempt = { step: StepKey; attempt: number; startedAt: string; endedAt: string; outcome: "DONE" | "FAILED"; error?: string };
export type Project = { id: string; title: string; createdAt: string; status: Status; stepState: "IDLE" | "RUNNING" | "FAILED"; activeStep?: StepKey; stepStartedAt?: string; lastError?: string; bookPreview: string; style?: string; characters: Asset[]; chapters: Asset[]; history?: Attempt[] };
type User = { name: string; email: string };

const stepMeta: { key: StepKey; label: string; status: Status; description: string }[] = [
  { key: "STYLE", label: "Style", status: "STYLE_SET", description: "Choose the visual language for this book." },
  { key: "CHARACTERS", label: "Characters", status: "CHARACTERS_GENERATED", description: "Find up to two important adult characters." },
  { key: "PORTRAITS", label: "Portraits", status: "PORTRAITS_GENERATED", description: "Generate one reference portrait per character." },
  { key: "CHAPTERS", label: "Chapters", status: "CHAPTERS_GENERATED", description: "Prepare one scene prompt that uses the character context." },
  { key: "ILLUSTRATIONS", label: "Illustrations", status: "DONE", description: "Generate the final illustrated scene." }
];
const currentStep = (status: Status) => stepMeta.find((step) => stepMeta.indexOf(step) === ["CREATED", "STYLE_SET", "CHARACTERS_GENERATED", "PORTRAITS_GENERATED", "CHAPTERS_GENERATED", "DONE"].indexOf(status))?.key;
const completedCount = (status: Status) => ["CREATED", "STYLE_SET", "CHARACTERS_GENERATED", "PORTRAITS_GENERATED", "CHAPTERS_GENERATED", "DONE"].indexOf(status);

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { ...(options?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options?.headers }, ...options });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || "Request failed."); }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [view, setView] = useState<"list" | "new" | "detail">("list");
  const [projectId, setProjectId] = useState<string>();
  const [project, setProject] = useState<Project & { bookText?: string }>();
  const [ready, setReady] = useState(false);

  const loadProjects = useCallback(async () => {
    const data = await request<{ projects: Project[] }>("/api/projects");
    setProjects(data.projects);
  }, []);
  const loadProject = useCallback(async (id: string) => {
    const data = await request<{ project: Project; bookText: string }>(`/api/projects/${id}`);
    setProject({ ...data.project, bookText: data.bookText });
    await loadProjects();
  }, [loadProjects]);
  useEffect(() => { request<{ user: User }>("/api/session").then(async ({ user: saved }) => { setUser(saved); await loadProjects(); }).catch(() => setUser(null)).finally(() => setReady(true)); }, [loadProjects]);
  useEffect(() => {
    if (!projectId || view !== "detail" || project?.stepState !== "RUNNING") return;
    const interval = window.setInterval(() => loadProject(projectId).catch(() => undefined), 2000);
    return () => window.clearInterval(interval);
  }, [project?.stepState, projectId, view, loadProject]);
  if (!ready) return <div className="page-center"><div className="loading-card"><span className="skeleton-line wide" /><span className="skeleton-line" /></div></div>;
  if (!user) return <Identity onSignedIn={async (saved) => { setUser(saved); await loadProjects(); }} />;
  const openProject = async (id: string) => { setProjectId(id); setView("detail"); await loadProject(id); };
  const signOut = async () => { await request("/api/session", { method: "DELETE" }); setUser(null); setProject(undefined); setView("list"); };
  return <><Nav user={user} onProjects={() => setView("list")} onSignOut={signOut} />
    <main className="shell">
      {view === "list" && <ProjectList projects={projects} onNew={() => setView("new")} onOpen={openProject} />}
      {view === "new" && <NewProject onCancel={() => setView("list")} onCreated={async (id) => openProject(id)} />}
      {view === "detail" && project && <ProjectDetail project={project} onBack={() => setView("list")} onUpdated={() => loadProject(project.id)} />}
    </main></>;
}

function Identity({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(""); setSaving(true); try { const data = await request<{ user: User }>("/api/session", { method: "POST", body: JSON.stringify({ name, email }) }); onSignedIn(data.user); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to sign in."); } finally { setSaving(false); } };
  return <main className="page-center"><form className="auth-card" onSubmit={submit}><Brand /><h1>Book Illustration Studio</h1><p>Start a new project or pick up an existing pipeline with your email address.</p><Field label="Full name" required><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></Field><Field label="Email" required><input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" /></Field>{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary" disabled={saving}>{saving ? "Signing in" : "Continue"}</button><p className="fine-print">No password is required for this local assessment app.</p></form></main>;
}
function Nav({ user, onProjects, onSignOut }: { user: User; onProjects: () => void; onSignOut: () => void }) { return <header className="nav"><div className="nav-inner"><button className="brand-button" onClick={onProjects} aria-label="Open projects"><Brand /></button><button className="nav-link" onClick={onProjects}>Projects</button><div className="nav-user"><span className="avatar">{user.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><span>{user.name}</span><button className="text-button" onClick={onSignOut}>Sign out</button></div></div></header>; }
function Brand() { return <span className="brand"><span className="brand-mark">G</span><span>GRADION</span></span>; }
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) { return <label className="field"><span>{label}{required && <b> *</b>}</span>{children}</label>; }

export function ProjectList({ projects, onNew, onOpen }: { projects: Project[]; onNew: () => void; onOpen: (id: string) => void }) {
  return <section><div className="page-heading"><div><h1>Your projects</h1><p>Each project preserves its progress and generated assets.</p></div><button className="button primary" onClick={onNew}>New project</button></div>{projects.length === 0 ? <div className="empty"><h2>No projects yet</h2><p>Create a project with a book's text to begin the illustration pipeline.</p><button className="button primary" onClick={onNew}>Create project</button></div> : <div className="project-list">{projects.map((project) => <button className="project-row" key={project.id} onClick={() => onOpen(project.id)}><div><strong>{project.title}</strong><span>Created {new Date(project.createdAt).toLocaleDateString()}</span></div><MiniProgress count={completedCount(project.status)} /><StatusPill project={project} /></button>)}</div>}</section>;
}
function MiniProgress({ count }: { count: number }) { return <span className="mini-progress" aria-label={`${count} of 5 stages complete`}>{[0, 1, 2, 3, 4].map((index) => <i key={index} className={index < count ? "on" : ""} />)}</span>; }
function StatusPill({ project }: { project: Project }) { const label = project.stepState === "FAILED" ? "Needs retry" : project.status === "DONE" ? "Done" : project.status === "CREATED" ? "Draft" : "In progress"; return <span className={`status ${project.stepState === "FAILED" ? "danger" : project.status === "DONE" ? "done" : ""}`}>{label}</span>; }

function NewProject({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState(""); const [bookText, setBookText] = useState(""); const [file, setFile] = useState<File>(); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!title.trim() || (!bookText.trim() && !file)) { setError("Add a title and either paste text or upload a .txt file."); return; } setSaving(true); setError(""); try { const form = new FormData(); form.set("title", title); if (file) form.set("file", file); else form.set("bookText", bookText); const data = await request<{ project: Project }>("/api/projects", { method: "POST", body: form }); onCreated(data.project.id); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create project."); } finally { setSaving(false); } };
  return <section className="narrow"><button className="back" onClick={onCancel}>Back to projects</button><h1>New illustration project</h1><p>Provide a title and the complete book text. Gemini receives the book once, then the pipeline chains its context.</p><form className="form-card" onSubmit={submit}><Field label="Project title" required><input value={title} onChange={(event) => setTitle(event.target.value)} /></Field><Field label="Book text" required><label className="upload"><input type="file" accept=".txt,text/plain" onChange={(event) => { const selected = event.target.files?.[0]; setFile(selected); if (selected) setBookText(""); }} /><strong>{file ? file.name : "Choose a .txt file"}</strong><span>Plain text files only, up to 8 MB</span></label><span className="or">or paste text</span><textarea rows={10} value={bookText} onChange={(event) => { setBookText(event.target.value); setFile(undefined); }} /></Field>{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary" disabled={saving}>{saving ? "Creating project" : "Create project"}</button></form></section>;
}

function ProjectDetail({ project, onBack, onUpdated }: { project: Project & { bookText?: string }; onBack: () => void; onUpdated: () => void }) {
  const [style, setStyle] = useState(""); const [actionError, setActionError] = useState(""); const [acting, setActing] = useState(false); const step = currentStep(project.status); const isStale = project.stepState === "RUNNING" && !!project.stepStartedAt && Date.now() - Date.parse(project.stepStartedAt) > 10 * 60 * 1000;
  const run = async () => { if (!step) return; setActing(true); setActionError(""); try { await request(`/api/projects/${project.id}/run/${step}`, { method: "POST", body: JSON.stringify({ style }) }); await onUpdated(); } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Unable to start this step."); } finally { setActing(false); } };
  const recover = async () => { setActing(true); try { await request(`/api/projects/${project.id}/recover`, { method: "POST" }); await onUpdated(); } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Unable to recover this step."); } finally { setActing(false); } };
  return <section><button className="back" onClick={onBack}>Back to projects</button><div className="detail-heading"><div><h1>{project.title}</h1><p>Created {new Date(project.createdAt).toLocaleDateString()}</p></div><StatusPill project={project} /></div><Stepper project={project} />
    <div className="detail-grid"><div><section className="action-panel"><h2>{project.status === "DONE" ? "Project complete" : project.stepState === "RUNNING" ? `${stepMeta.find((item) => item.key === project.activeStep)?.label} is running` : project.stepState === "FAILED" ? "This step needs a retry" : `Ready for ${stepMeta.find((item) => item.key === step)?.label}`}</h2>{project.status !== "DONE" && <p>{project.stepState === "RUNNING" ? "The server is working. You can refresh or leave this page safely." : project.stepState === "FAILED" ? project.lastError : stepMeta.find((item) => item.key === step)?.description}</p>}{step === "STYLE" && project.stepState !== "RUNNING" && <Field label="Art style (optional)"><input value={style} onChange={(event) => setStyle(event.target.value)} placeholder="Leave blank to let Gemini choose" /></Field>}{project.stepState === "RUNNING" && <div className="run-indicator"><span className="loader" />Saving results as they arrive</div>}{isStale && <button className="button secondary" onClick={recover} disabled={acting}>Recover interrupted step</button>}{!isStale && project.status !== "DONE" && project.stepState !== "RUNNING" && <button className="button primary" onClick={run} disabled={acting}>{acting ? "Starting" : project.stepState === "FAILED" ? `Retry ${stepMeta.find((item) => item.key === step)?.label}` : `Generate ${stepMeta.find((item) => item.key === step)?.label}`}</button>}{actionError && <p className="form-error" role="alert">{actionError}</p>}</section><AssetSection title="Characters" assets={project.characters} kind="portrait" generating={project.stepState === "RUNNING" && project.activeStep === "PORTRAITS"} /><AssetSection title="Chapters" assets={project.chapters} kind="illustration" generating={project.stepState === "RUNNING" && project.activeStep === "ILLUSTRATIONS"} /></div><aside><div className="side-panel"><h2>Book text</h2><p>{project.bookPreview}</p><details><summary>Read full text</summary><pre>{project.bookText}</pre></details></div>{project.style && <div className="side-panel"><h2>Style</h2><p>{project.style}</p></div>}<HistoryPanel history={project.history} /></aside></div></section>;
}
function Stepper({ project }: { project: Project }) { const done = completedCount(project.status); return <ol className="stepper">{stepMeta.map((step, index) => <li key={step.key} className={index < done ? "done" : index === done ? "current" : "pending"}><span>{index < done ? "Done" : index + 1}</span><b>{step.label}</b></li>)}</ol>; }
function AssetSection({ title, assets, kind, generating }: { title: string; assets: Asset[]; kind: string; generating: boolean }) { if (!assets.length) return null; return <section className="asset-section"><h2>{title}</h2><div className={`asset-grid ${kind}`} >{assets.map((asset) => <article className="asset-card" key={asset.name}>{asset.imageUrl ? <img src={asset.imageUrl} alt={`${kind} of ${asset.name}`} /> : <div className="asset-placeholder">{generating ? <><span className="loader" />Generating {asset.name}</> : "Not generated yet"}</div>}<div><h3>{asset.name}</h3><p>{asset.prompt}</p></div></article>)}</div></section>; }
function HistoryPanel({ history }: { history?: Attempt[] }) {
  if (!history?.length) return null;
  const hasFailure = history.some((entry) => entry.outcome === "FAILED");
  const recent = history.slice().reverse();
  return <div className="side-panel"><h2>Attempt history</h2><details open={hasFailure}><summary>{history.length} attempt{history.length === 1 ? "" : "s"} recorded</summary><ol className="history-list">{recent.map((entry, index) => <li key={index} className={entry.outcome}><div><strong>{stepMeta.find((item) => item.key === entry.step)?.label}</strong><span>Attempt {entry.attempt} · {entry.outcome === "DONE" ? "Succeeded" : "Failed"}</span></div><time dateTime={entry.endedAt}>{new Date(entry.endedAt).toLocaleString()}</time>{entry.error && <p className="form-error">{entry.error}</p>}</li>)}</ol></details></div>;
}
