export const STEPS = ["STYLE", "CHARACTERS", "PORTRAITS", "CHAPTERS", "ILLUSTRATIONS"] as const;
export type StepKey = (typeof STEPS)[number];
export type ProjectStatus = "CREATED" | "STYLE_SET" | "CHARACTERS_GENERATED" | "PORTRAITS_GENERATED" | "CHAPTERS_GENERATED" | "DONE";
export type StepState = "IDLE" | "RUNNING" | "FAILED";

export type Asset = { name: string; prompt: string; imageUrl?: string; imageState?: "PENDING" | "DONE" };

export type Project = {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  status: ProjectStatus;
  stepState: StepState;
  activeStep?: StepKey;
  stepStartedAt?: string;
  lastError?: string;
  bookPath: string;
  bookPreview: string;
  style?: string;
  characters: Asset[];
  chapters: (Asset & { characters: string[] })[];
  gemini?: { fileUri?: string; bookInteractionId?: string; lastTextInteractionId?: string };
};

export type User = { id: string; name: string; email: string; createdAt: string };

export const completedStatusFor: Record<StepKey, ProjectStatus> = {
  STYLE: "STYLE_SET",
  CHARACTERS: "CHARACTERS_GENERATED",
  PORTRAITS: "PORTRAITS_GENERATED",
  CHAPTERS: "CHAPTERS_GENERATED",
  ILLUSTRATIONS: "DONE"
};

export function nextStep(status: ProjectStatus): StepKey | undefined {
  const steps: Record<ProjectStatus, StepKey | undefined> = {
    CREATED: "STYLE",
    STYLE_SET: "CHARACTERS",
    CHARACTERS_GENERATED: "PORTRAITS",
    PORTRAITS_GENERATED: "CHAPTERS",
    CHAPTERS_GENERATED: "ILLUSTRATIONS",
    DONE: undefined
  };
  return steps[status];
}
