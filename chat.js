import OpenAI from "openai";
import { getOpenAIKey, setOpenAIKey as persistOpenAIKey } from "./config/settings.js";

// Running totals
let totalTokens = 0;
let totalCost = 0.0;

const PRICE_INPUT = 0.005 / 1000; // $0.005 / 1K input tokens
const PRICE_OUTPUT = 0.015 / 1000; // $0.015 / 1K output tokens

let currentKey = process.env.OPENAI_API_KEY ?? null;
let client = currentKey ? createClient(currentKey) : null;

function createClient(apiKey) {
  const instance = new OpenAI({ apiKey });
  instance._commanddeskKey = apiKey;
  return instance;
}

async function resolveApiKey() {
  if (currentKey) {
    return currentKey;
  }

  currentKey = await getOpenAIKey();
  return currentKey;
}

async function ensureClient() {
  const apiKey = await resolveApiKey();

  if (!apiKey) {
    throw new Error("OpenAI API key is not configured. Add one in the API Settings tab.");
  }

  if (!client || client._commanddeskKey !== apiKey) {
    client = createClient(apiKey);
  }

  return client;
}

export async function configureOpenAIKey(newKey) {
  currentKey = typeof newKey === "string" && newKey.trim() ? newKey.trim() : null;
  client = currentKey ? createClient(currentKey) : null;

  await persistOpenAIKey(currentKey ?? "");

  return currentKey;
}

export async function sendMessage(message) {
  try {
    const openai = await ensureClient();

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: message }]
    });

    const reply = response.choices[0]?.message?.content ?? "";

    if (response.usage) {
      const { prompt_tokens, completion_tokens, total_tokens } = response.usage;
      totalTokens += total_tokens;

      const cost = prompt_tokens * PRICE_INPUT + completion_tokens * PRICE_OUTPUT;
      totalCost += cost;

      updateTokenFooter(totalTokens, totalCost);
    }

    return reply;
  } catch (err) {
    console.error("Error from OpenAI:", err);
    return `Error: ${err.message}`;
  }
}

function updateTokenFooter(tokens, cost) {
  const footer = typeof document !== "undefined" ? document.getElementById("token-footer") : null;
  if (footer) {
    footer.textContent = `Tokens used: ${tokens.toLocaleString()}   |   Approx. cost: $${cost.toFixed(
      4
    )}`;
  }
}
