import { GoogleGenAI } from "@google/genai";
import type { Asset } from "./types.js";

// Shape verified against the installed @google/genai@2.x's own .d.ts.
// v1.x (originally pinned, ^1.30.0) used a different, now-rejected schema —
// the live API returns 400 "legacy Interactions API schema is no longer
// supported" for it (see DECISIONS.md). v2's Interaction response carries
// convenience fields the SDK computes for you: output_text / output_image.
type Interaction = { id: string; status?: string; output_text?: string; output_image?: { data?: string; mime_type?: string } };
export type GeneratedImage = { bytes: Buffer; extension: string };

export interface GeminiGateway {
  beginBook(bookPath: string): Promise<{ fileUri: string; interactionId: string }>;
  setStyle(previousId: string, suppliedStyle?: string): Promise<{ interactionId: string; style: string }>;
  generateCharacters(previousId: string): Promise<{ interactionId: string; characters: Asset[] }>;
  portraitContext(style: string): Promise<string>;
  generatePortrait(previousId: string, character: Asset): Promise<{ interactionId: string; image: GeneratedImage }>;
  generateChapters(previousId: string): Promise<{ interactionId: string; chapters: (Asset & { characters: string[] })[] }>;
  illustrationContext(style: string): Promise<string>;
  generateIllustration(previousId: string, chapter: Asset, portraits: GeneratedImage[]): Promise<{ interactionId: string; image: GeneratedImage }>;
}

const imageRules = "No words, title, border, panels, or collage. Render one complete family-friendly illustration.";
const ensureCompleted = (interaction: Interaction) => {
  if (interaction.status && interaction.status !== "completed") throw new Error(`Gemini interaction did not complete (status: ${interaction.status}).`);
};
const asText = (interaction: Interaction) => {
  if (!interaction.output_text) throw new Error("Gemini returned no text output.");
  return interaction.output_text;
};
const parseList = <T>(text: string) => {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("Gemini returned JSON that was not a list.");
  return parsed as T[];
};
const imageFrom = (interaction: Interaction): GeneratedImage => {
  if (!interaction.output_image?.data) throw new Error("Gemini returned no image output.");
  const mime = interaction.output_image.mime_type ?? "image/png";
  return { bytes: Buffer.from(interaction.output_image.data, "base64"), extension: mime.includes("jpeg") ? "jpg" : "png" };
};

export class GeminiClient implements GeminiGateway {
  private ai: GoogleGenAI;
  // gemini-3.7-flash is current and GA. gemini-2.5-flash-image (the original
  // Nano Banana) is used over the newer 3.1 Lite variant because the newer
  // model has no free-tier quota at all via the API — see DECISIONS.md.
  private textModel = process.env.GEMINI_TEXT_MODEL || "gemini-3.7-flash";
  private imageModel = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
  constructor() {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured. Add it to .env and restart the server.");
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  // `schema` is the raw JSON Schema for structured output. v2's response_format
  // is a typed object: { type: "text", mime_type: "application/json", schema }.
  private async text(input: unknown, previous?: string, schema?: unknown) {
    const interaction = await this.ai.interactions.create({
      model: this.textModel,
      input,
      previous_interaction_id: previous,
      ...(schema ? { response_format: { type: "text", mime_type: "application/json", schema } } : {})
    } as never) as unknown as Interaction;
    ensureCompleted(interaction);
    return interaction;
  }
  // Image output: response_format = { type: "image", aspect_ratio, mime_type }.
  // No separate response_modalities/generation_config.image_config needed in v2.
  private async image(input: unknown, previous?: string, ratio = "9:16") {
    const interaction = await this.ai.interactions.create({
      model: this.imageModel,
      input,
      previous_interaction_id: previous,
      // The API only accepts image/jpeg here (image/png returns 400 "not supported"),
      // confirmed by a real call — see DECISIONS.md.
      response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: ratio }
    } as never) as unknown as Interaction;
    ensureCompleted(interaction);
    return interaction;
  }
  async beginBook(bookPath: string) {
    const uploaded = await this.ai.files.upload({ file: bookPath, config: { mimeType: "text/plain" } }) as unknown as { uri: string };
    const interaction = await this.text([{ type: "text", text: "Here is a book to illustrate. Keep its details in context. Do not respond until prompted." }, { type: "document", uri: uploaded.uri }]);
    return { fileUri: uploaded.uri, interactionId: interaction.id };
  }
  async setStyle(previousId: string, suppliedStyle?: string) {
    const prompt = suppliedStyle
      ? `The art style is: "${suppliedStyle}". Remember it for every future illustration. Do not add commentary.`
      : "Define one concise art-style prompt that fits this story with an imaginative twist. Return only the style prompt.";
    const interaction = await this.text(prompt, previousId);
    return { interactionId: interaction.id, style: suppliedStyle || asText(interaction).trim() };
  }
  async generateCharacters(previousId: string) {
    const interaction = await this.text("List the two most important adult characters only. For each, provide a name and a detailed, book-grounded Nano Banana portrait prompt of at least 50 words. Exclude children.", previousId, { type: "array", items: { type: "object", properties: { name: { type: "string" }, prompt: { type: "string" } }, required: ["name", "prompt"] } });
    return { interactionId: interaction.id, characters: parseList<Asset>(asText(interaction)).slice(0, 2).map(({ name, prompt }): Asset => ({ name, prompt, imageState: "PENDING" })) };
  }
  async portraitContext(style: string) {
    const interaction = await this.image(`You will create character portraits for this book. Follow this style: ${style}. ${imageRules}`, undefined, "9:16");
    return interaction.id;
  }
  async generatePortrait(previousId: string, character: Asset) {
    const interaction = await this.image(`Create the portrait of ${character.name}. ${character.prompt}`, previousId, "9:16");
    return { interactionId: interaction.id, image: imageFrom(interaction) };
  }
  async generateChapters(previousId: string) {
    const interaction = await this.text("Provide one chapter-scene illustration prompt only. It must depict a single scene, name the characters present, and reuse the established character details. Return JSON with name, prompt, and characters.", previousId, { type: "array", items: { type: "object", properties: { name: { type: "string" }, prompt: { type: "string" }, characters: { type: "array", items: { type: "string" } } }, required: ["name", "prompt", "characters"] } });
    return { interactionId: interaction.id, chapters: parseList<Asset & { characters: string[] }>(asText(interaction)).slice(0, 1).map((chapter): Asset & { characters: string[] } => ({ ...chapter, imageState: "PENDING" })) };
  }
  async illustrationContext(style: string) {
    const interaction = await this.image(`You will create a chapter scene. Follow this style: ${style}. Preserve the attached character references. ${imageRules}`, undefined, "16:9");
    return interaction.id;
  }
  async generateIllustration(previousId: string, chapter: Asset, portraits: GeneratedImage[]) {
    const input = [{ type: "text", text: `Create the scene named ${chapter.name}: ${chapter.prompt}` }, ...portraits.map((portrait) => ({ type: "image", data: portrait.bytes.toString("base64"), mime_type: `image/${portrait.extension === "jpg" ? "jpeg" : "png"}` }))];
    const interaction = await this.image(input, previousId, "16:9");
    return { interactionId: interaction.id, image: imageFrom(interaction) };
  }
}
