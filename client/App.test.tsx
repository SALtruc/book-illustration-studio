import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectList, type Project } from "./App";

const base: Project = { id: "1", title: "River story", createdAt: "2026-08-18T00:00:00.000Z", status: "CREATED", stepState: "IDLE", bookPreview: "A story", characters: [], chapters: [] };

describe("ProjectList", () => {
  it("shows an intentional empty state with a clear next action", async () => {
    const onNew = vi.fn();
    render(<ProjectList projects={[]} onNew={onNew} onOpen={vi.fn()} />);
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    screen.getByRole("button", { name: "Create project" }).click();
    expect(onNew).toHaveBeenCalledOnce();
  });
  it("shows status and progress before opening a project", async () => {
    const onOpen = vi.fn();
    render(<ProjectList projects={[{ ...base, status: "PORTRAITS_GENERATED", stepState: "FAILED" }]} onNew={vi.fn()} onOpen={onOpen} />);
    expect(screen.getByText("Needs retry")).toBeInTheDocument();
    expect(screen.getByLabelText("3 of 5 stages complete")).toBeInTheDocument();
    screen.getByRole("button", { name: /River story/ }).click();
    expect(onOpen).toHaveBeenCalledWith("1");
  });
});
