/**
 * OpenAI provider adapter for the AI gateway.
 *
 * Implements `RecommendChartProvider` by calling the OpenAI Chat
 * Completions API with a JSON-mode prompt. The gateway handles
 * timeouts, Zod validation, and fallback; this module only needs to
 * make the HTTP call and return the parsed result or throw.
 *
 * Activated by `AI_PROVIDER=openai` and `OPENAI_API_KEY` env var.
 * When the key is missing the provider is not instantiated (gateway
 * falls back to core).
 */

import type { Profile, Recommendation } from "@reports/shared";
import type { RecommendChartProvider } from "../providers.js";

export class OpenAIProvider implements RecommendChartProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(opts: { apiKey: string; model?: string; baseUrl?: string }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? "gpt-4o-mini";
    this.baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
  }

  async recommendChart(profile: Profile, signal: AbortSignal): Promise<Recommendation[]> {
    const systemPrompt = `You are a chart-type recommender. Given a data profile (field names, types, cardinalities), return a JSON array of recommended chart types with scores and reasons. Output ONLY valid JSON matching: [{"chart":"<type>","score":<0-1>,"reason":"<short>"}]. Max 10 items. Chart types must be from the canonical set.`;

    const userPrompt = JSON.stringify(profile);

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 1024,
      }),
      signal,
    });

    if (!res.ok) {
      throw new Error(`openai ${res.status}: ${await res.text().catch(() => "")}`);
    }

    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("empty openai response");

    const parsed = JSON.parse(content) as
      | Recommendation[]
      | { recommendations: Recommendation[] };

    // Normalize: the model might wrap in an object or return a bare array.
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.recommendations)
        ? parsed.recommendations
        : [];

    if (list.length === 0) throw new Error("openai returned empty recommendations");
    return list;
  }
}

/**
 * Factory: returns an OpenAIProvider if OPENAI_API_KEY is set, else null.
 */
export function createOpenAIProvider(): OpenAIProvider | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAIProvider({
    apiKey: key,
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  });
}
