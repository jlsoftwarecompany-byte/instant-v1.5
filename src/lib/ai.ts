/**
 * AI Messaging Layer (Strategic Plan §4).
 *
 * Uses the existing @google/genai dependency. Lazy-imported so the chat bundle
 * stays slim and so SSR / non-AI flows don't pay the import cost.
 *
 * All calls degrade gracefully: if the API key is missing or the request fails
 * the helpers return null instead of throwing, so the UI can simply hide the
 * suggestion strip without breaking the conversation.
 */
const MODEL_TEXT = "gemini-2.5-flash";

const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY as string | undefined;

let _client: any = null;
async function client(): Promise<any | null> {
  if (!apiKey) return null;
  if (_client) return _client;
  try {
    const mod: any = await import("@google/genai");
    _client = new mod.GoogleGenAI({ apiKey });
    return _client;
  } catch (e) {
    console.warn("[ai] @google/genai unavailable", e);
    return null;
  }
}

async function generate(prompt: string, system?: string): Promise<string | null> {
  const c = await client();
  if (!c) return null;
  try {
    const res = await c.models.generateContent({
      model: MODEL_TEXT,
      contents: prompt,
      ...(system ? { config: { systemInstruction: system } } : {}),
    });
    const text = (res as any)?.text || (res as any)?.response?.text?.() || null;
    return typeof text === "string" ? text.trim() : null;
  } catch (e) {
    console.warn("[ai] generate failed", e);
    return null;
  }
}

export async function suggestReplies(history: { sender: string; content: string }[], me: string): Promise<string[]> {
  if (!history.length) return [];
  const transcript = history.slice(-8)
    .map(m => `${m.sender === me ? "Me" : m.sender}: ${m.content}`).join("\n");
  const out = await generate(
    `Suggest exactly 3 short, casual Gen-Z replies (under 40 chars each) for "Me" to send next. Return as a JSON array of strings, no commentary.\n\n${transcript}`,
    "You are an upbeat messaging assistant for a private Gen-Z chat app."
  );
  if (!out) return [];
  try {
    const json = out.replace(/^```json?/i, "").replace(/```$/, "").trim();
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.slice(0, 3).map(String) : [];
  } catch { return out.split("\n").filter(Boolean).slice(0, 3); }
}

export type Tone = "friendly" | "flirty" | "professional" | "savage" | "soft";
export async function rewriteTone(text: string, tone: Tone): Promise<string | null> {
  return generate(`Rewrite this message in a ${tone} tone, same language, keep it short:\n\n${text}`);
}

export async function translate(text: string, targetLang: string): Promise<string | null> {
  return generate(`Translate the following message to ${targetLang}. Only output the translation:\n\n${text}`);
}

export async function transcribeVoice(_blob: Blob): Promise<string | null> {
  // Stub: real implementation uploads audio to the AI gateway. Returns null so
  // callers can show "Transcription unavailable" instead of throwing.
  console.info("[ai] transcribeVoice not yet wired in v1.5");
  return null;
}
