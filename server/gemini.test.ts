import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiClient } from "./gemini.js";

// GeminiGateway (pipeline.test.ts) is faked at the interface level, so it never
// exercises the translation to/from the real @google/genai Interactions API shape.
// These tests mock only the SDK client itself and assert on the actual wire shape
// (output_text / output_image, response_format, snake_case fields) verified
// against node_modules/@google/genai@2.x's own type definitions. v1.x used a
// different schema that the live API now rejects with a 400 "legacy Interactions
// API schema is no longer supported" — see DECISIONS.md for the full story.
const create = vi.fn();
const upload = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({ interactions: { create }, files: { upload } }))
}));

const textInteraction = (text: string) => ({ id: "interaction-1", status: "completed", output_text: text });
const imageInteraction = (data: string) => ({ id: "interaction-2", status: "completed", output_image: { data, mime_type: "image/png" } });

describe("GeminiClient", () => {
  beforeEach(() => {
    create.mockReset();
    upload.mockReset();
    process.env.GEMINI_API_KEY = "test-key";
  });

  it("uploads the book once and starts the interaction chain", async () => {
    upload.mockResolvedValue({ uri: "files/book-1" });
    create.mockResolvedValue(textInteraction("ignored"));
    const result = await new GeminiClient().beginBook("book.txt");
    expect(upload).toHaveBeenCalledWith({ file: "book.txt", config: { mimeType: "text/plain" } });
    expect(result).toEqual({ fileUri: "files/book-1", interactionId: "interaction-1" });
    expect(create.mock.calls[0][0].input).toEqual(expect.arrayContaining([expect.objectContaining({ type: "document", uri: "files/book-1" })]));
  });

  it("reads structured JSON from output_text and sends the schema in response_format", async () => {
    create.mockResolvedValue(textInteraction(JSON.stringify([{ name: "Mole", prompt: "A kind mole." }, { name: "Rat", prompt: "A boating rat." }, { name: "Extra", prompt: "Ignored." }])));
    const result = await new GeminiClient().generateCharacters("prev-id");
    expect(result.characters).toHaveLength(2);
    expect(result.characters[0]).toMatchObject({ name: "Mole", imageState: "PENDING" });
    const params = create.mock.calls[0][0];
    expect(params.response_format).toMatchObject({ type: "text", mime_type: "application/json", schema: { type: "array" } });
  });

  it("reads image bytes from output_image and requests an image response_format with an aspect ratio", async () => {
    create.mockResolvedValue(imageInteraction(Buffer.from("pixel").toString("base64")));
    const result = await new GeminiClient().generatePortrait("prev-id", { name: "Mole", prompt: "A kind mole." });
    expect(result.image.bytes.toString()).toBe("pixel");
    expect(result.image.extension).toBe("png");
    const params = create.mock.calls[0][0];
    expect(params.response_format).toMatchObject({ type: "image", aspect_ratio: "9:16" });
  });

  it("throws a clear error when the interaction did not complete", async () => {
    create.mockResolvedValue({ id: "interaction-3", status: "failed" });
    await expect(new GeminiClient().setStyle("prev-id")).rejects.toThrow(/did not complete/);
  });

  it("sends reference portraits with snake_case mime_type, matching ImageContent", async () => {
    create.mockResolvedValue(imageInteraction(Buffer.from("scene").toString("base64")));
    await new GeminiClient().generateIllustration("prev-id", { name: "Opening", prompt: "A scene." }, [{ bytes: Buffer.from("portrait"), extension: "png" }]);
    const imagePart = create.mock.calls[0][0].input.find((part: { type: string }) => part.type === "image");
    expect(imagePart.mime_type).toBe("image/png");
    expect(imagePart.mimeType).toBeUndefined();
  });
});
