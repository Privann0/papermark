import OpenAI from "openai";

// Create an OpenAI API client (that's edge friendly!)
let openAIClient: OpenAI | null = null;

/**
 * Lazily create the OpenAI client.
 *
 * Next.js imports server modules while collecting build-time route data.
 * Constructing the SDK at module scope makes a build require runtime
 * credentials even when no AI endpoint is executed.
 */
export function getOpenAIClient(): OpenAI {
  if (!openAIClient) {
    openAIClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || "",
    });
  }

  return openAIClient;
}

/**
 * Backwards-compatible lazy facade for existing call sites.
 * The SDK is instantiated only when one of its properties is actually used.
 */
export const openai = new Proxy({} as OpenAI, {
  get(_target, property) {
    const client = getOpenAIClient();
    const value = Reflect.get(client, property, client);

    return typeof value === "function" ? value.bind(client) : value;
  },
});
