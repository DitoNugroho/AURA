import OpenAI from "openai";

export const embeddingProvider = process.env.EMBEDDING_PROVIDER || (process.env.VERCEL ? "openai" : "ollama");
export const embeddingModel = embeddingProvider === "ollama"
  ? process.env.OLLAMA_EMBEDDING_MODEL || "bge-m3"
  : "text-embedding-3-small";
export const embeddingDimensions = embeddingProvider === "ollama" ? 1024 : 1536;
export const embeddingProviderLabel = embeddingProvider === "ollama"
  ? `Ollama (${embeddingModel})`
  : `OpenAI (${embeddingModel})`;

function getOpenAIEmbeddings() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY belum dikonfigurasi untuk embedding knowledge base.");
  return new OpenAI({ apiKey: key });
}

function getDataByte() {
  const key = process.env.DATABYTE_API_KEY;
  if (!key) throw new Error("DATABYTE_API_KEY belum dikonfigurasi.");
  return new OpenAI({
    apiKey: key,
    baseURL: process.env.DATABYTE_BASE_URL || "https://ai.databyte.co.id/v1",
  });
}

export async function embedTexts(texts: string[]) {
  if (!texts.length) return [];
  if (embeddingProvider === "ollama") {
    const baseUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: embeddingModel, input: texts }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Ollama embedding gagal (${response.status}): ${detail.slice(0, 300)}`);
    }
    const result = await response.json() as { embeddings?: number[][] };
    const vectors = result.embeddings;
    if (!vectors || vectors.length !== texts.length || vectors.some(vector => vector.length !== embeddingDimensions)) {
      throw new Error(`Dimensi embedding ${embeddingModel} tidak sesuai. AURA mengharapkan ${embeddingDimensions} angka per teks.`);
    }
    return vectors;
  }

  const result = await getOpenAIEmbeddings().embeddings.create({
    model: embeddingModel,
    input: texts,
  });
  const vectors = result.data.sort((a, b) => a.index - b.index).map(item => item.embedding);
  if (vectors.length !== texts.length || vectors.some(vector => vector.length !== embeddingDimensions)) {
    throw new Error(`Ukuran embedding ${embeddingModel} tidak sesuai dengan skema database AURA.`);
  }
  return vectors;
}

export async function generateDraftText(instructions: string, input: string) {
  const model = process.env.DATABYTE_MODEL || "MiniMax-M3";
  const normalizedModel = model.toLowerCase();
  const isMiniMax31Flash = normalizedModel.includes("minimax-m3.1-flash");
  const isMiniMax3 = normalizedModel.includes("minimax-m3") && !isMiniMax31Flash;
  // Some DataByte reasoning models spend the whole completion budget on
  // internal reasoning (and return no visible text) when given long T.1.1
  // context. Keep a configurable budget and allow a larger ceiling for these
  // models; callers can set DATABYTE_MAX_TOKENS per deployment.
  const configuredMaxTokens = Number(process.env.DATABYTE_MAX_TOKENS || 16384);
  const maxTokens = Number.isInteger(configuredMaxTokens) && configuredMaxTokens >= 256
    ? Math.min(configuredMaxTokens, 32768)
    : 16384;
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: `${instructions}\n\nPENTING: Berikan hanya hasil akhir yang diminta. Jangan tampilkan penalaran internal, proses berpikir, analisis langkah demi langkah, atau teks pembuka. Untuk jawaban terstruktur, keluarkan langsung format yang diminta.` },
    { role: "user", content: input },
  ];
  const requestBody = {
    model,
    max_completion_tokens: maxTokens,
    messages,
    ...(isMiniMax3 ? { thinking: { type: "disabled" as const } } : {}),
    ...(isMiniMax31Flash ? { reasoning_effort: "low" as const } : {}),
  };
  const result = await getDataByte().chat.completions.create(requestBody);
  const choice = result.choices[0];
  const messageContent: unknown = choice?.message?.content;
  const text = typeof messageContent === "string"
    ? messageContent.trim()
    : Array.isArray(messageContent)
      ? messageContent.map((part: { type?: unknown; text?: unknown }) => part.type === "text" && typeof part.text === "string" ? part.text : "").join("\n").trim()
      : "";
  if (!text) {
    const completionTokens = result.usage?.completion_tokens;
    const details = [
      `model=${result.model || model}`,
      choice?.finish_reason ? `finish_reason=${choice.finish_reason}` : "finish_reason=tidak tersedia",
      typeof completionTokens === "number" ? `completion_tokens=${completionTokens}` : "completion_tokens=tidak tersedia",
      typeof result.usage?.completion_tokens_details?.reasoning_tokens === "number" ? `reasoning_tokens=${result.usage.completion_tokens_details.reasoning_tokens}` : "",
      choice?.message?.refusal ? "respons ditolak model" : "konten jawaban kosong",
    ].filter(Boolean).join(", ");
    const remedy = choice?.finish_reason === "length"
      ? `Respons berhenti pada batas ${maxTokens} token sebelum teks jawaban tersedia. Model ${model} kemungkinan memakai seluruh jatah untuk reasoning atau tidak kompatibel dengan parameter token/format endpoint DataByte. Coba naikkan DATABYTE_MAX_TOKENS (batas AURA ${32768}) atau gunakan model DataByte yang mengembalikan teks pada endpoint Chat Completions. Model MiniMax-M3.1-Flash dijalankan dengan reasoning_effort=low; MiniMax-M3 dengan thinking nonaktif.`
      : "Periksa ID model dan kompatibilitas respons endpoint DataByte.";
    throw new Error(`DataByte mengembalikan respons tanpa teks (${details}). ${remedy}`);
  }
  return {
    text,
    truncated: choice?.finish_reason === "length",
    finishReason: choice?.finish_reason ?? null,
    completionTokens: result.usage?.completion_tokens ?? null,
  };
}

export function splitIntoChunks(text: string, size = 4200, overlap = 350) {
  const cleaned = text.replace(/\u0000/g, " ").replace(/\r/g, "").trim();
  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = Math.min(start + size, cleaned.length);
    if (end < cleaned.length) {
      const boundary = cleaned.lastIndexOf("\n", end);
      if (boundary > start + size * 0.65) end = boundary;
    }
    const value = cleaned.slice(start, end).trim();
    if (value) chunks.push(value);
    if (end >= cleaned.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
