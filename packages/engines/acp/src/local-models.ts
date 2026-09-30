import type { ModelInfo } from "@openbot/contracts";

/**
 * Local model servers (D-031): Ollama and LM Studio both expose an OpenAI-compatible API, which
 * OpenCode drives as an agent. OpenBot only finds their models and makes sure the context is
 * big enough for an agent's prompt (Ollama's default of 4096 tokens truncates it silently).
 */
export type LocalProvider = "ollama" | "lmstudio";

export interface LocalServers {
  ollama: string;
  lmstudio: string;
  /** Context window OpenBot asks for (capped at what the model supports). */
  contextLength: number;
}

export interface LocalModel extends ModelInfo {
  provider: LocalProvider;
  /** The name the server knows the model by. */
  name: string;
  /** False when the server says the model cannot call tools (it will only chat). */
  tools?: boolean;
}

type Fetch = typeof fetch;

export const DEFAULT_CONTEXT_LENGTH = 32_768;

export function localServers(env: NodeJS.ProcessEnv = process.env): LocalServers {
  return {
    ollama: normalizeBase(env.OLLAMA_HOST, "http://127.0.0.1:11434"),
    lmstudio: normalizeBase(env.OPENBOT_LMSTUDIO_URL, "http://127.0.0.1:1234"),
    contextLength: Number(env.OPENBOT_LOCAL_CONTEXT) || DEFAULT_CONTEXT_LENGTH,
  };
}

function normalizeBase(value: string | undefined, fallback: string): string {
  const raw = value?.trim();
  if (!raw) return fallback;
  const withScheme = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
  // OLLAMA_HOST is often a bind address (`0.0.0.0:11434`): connect over loopback instead.
  return withScheme.replace("//0.0.0.0", "//127.0.0.1").replace(/\/+$/, "");
}

/** Prefix OpenBot uses for its own copies of Ollama models with a bigger context. */
const DERIVED_PREFIX = "openbot-";

export async function discoverOllama(base: string, doFetch: Fetch = fetch): Promise<LocalModel[]> {
  const tags = await getJson<{
    models?: Array<{ name: string; details?: { parameter_size?: string } }>;
  }>(doFetch, `${base}/api/tags`);
  const names = (tags?.models ?? [])
    .map((m) => m.name)
    .filter((name) => !name.startsWith(DERIVED_PREFIX));
  const shown = await Promise.all(
    names.map(async (name) => ({
      name,
      info: await postJson<{ capabilities?: string[]; model_info?: Record<string, unknown> }>(
        doFetch,
        `${base}/api/show`,
        { model: name },
      ),
    })),
  );
  return shown
    .filter(({ info }) => !info?.capabilities || info.capabilities.includes("completion"))
    .map(({ name, info }) => {
      const tools = info?.capabilities ? info.capabilities.includes("tools") : undefined;
      return {
        provider: "ollama" as const,
        name,
        id: `ollama/${name}`,
        label: `${name} (Ollama${tools === false ? ", no tools" : ""})`,
        contextWindow: contextOf(info?.model_info),
        local: true,
        tools,
      };
    });
}

export async function discoverLmStudio(
  base: string,
  doFetch: Fetch = fetch,
): Promise<LocalModel[]> {
  type Entry = { id: string; type?: string; max_context_length?: number; capabilities?: string[] };
  const rich = await fetchJson<{ data?: Entry[] }>(doFetch, `${base}/api/v0/models`);
  // Only a server that answered (an older LM Studio without the v0 API) is worth a second try:
  // something else listening on the port may never answer at all.
  const list: Entry[] =
    rich.status === "ok"
      ? (rich.data.data ?? [])
      : rich.status === "http"
        ? ((await getJson<{ data?: Entry[] }>(doFetch, `${base}/v1/models`))?.data ?? [])
        : [];
  return list
    .filter((m) => !m.type || m.type === "llm" || m.type === "vlm")
    .filter((m) => !/embed/i.test(m.id))
    .map((m) => {
      const tools = m.capabilities ? m.capabilities.includes("tool_use") : undefined;
      return {
        provider: "lmstudio" as const,
        name: m.id,
        id: `lmstudio/${m.id}`,
        label: `${m.id} (LM Studio${tools === false ? ", no tools" : ""})`,
        contextWindow: m.max_context_length,
        local: true,
        tools,
      };
    });
}

export async function discoverLocalModels(
  servers: LocalServers,
  doFetch: Fetch = fetch,
): Promise<LocalModel[]> {
  const [ollama, lmstudio] = await Promise.all([
    discoverOllama(servers.ollama, doFetch).catch(() => []),
    discoverLmStudio(servers.lmstudio, doFetch).catch(() => []),
  ]);
  return [...ollama, ...lmstudio];
}

/** `ollama/qwen3:8b` → `{ provider: "ollama", name: "qwen3:8b" }`; other ids are not local. */
export function parseLocalModelId(
  id: string,
): { provider: LocalProvider; name: string } | undefined {
  const match = /^(ollama|lmstudio)\/(.+)$/.exec(id);
  return match ? { provider: match[1] as LocalProvider, name: match[2]! } : undefined;
}

/**
 * Ollama serves every model with a 4096-token context unless told otherwise, and its
 * OpenAI-compatible API cannot be told per request. So OpenBot makes a copy of the model with
 * a bigger `num_ctx` (no weights are copied) and uses that. Returns the name to use.
 */
export async function ensureOllamaContext(
  base: string,
  name: string,
  contextLength: number,
  doFetch: Fetch = fetch,
): Promise<string> {
  const info = await postJson<{ model_info?: Record<string, unknown>; parameters?: string }>(
    doFetch,
    `${base}/api/show`,
    { model: name },
  );
  if (!info) return name;
  const max = contextOf(info.model_info);
  const wanted = max ? Math.min(max, contextLength) : contextLength;
  const current = /num_ctx\s+(\d+)/.exec(info.parameters ?? "");
  if (current && Number(current[1]) >= wanted) return name;
  const derived = `${DERIVED_PREFIX}${name.replace(/[^a-zA-Z0-9._-]+/g, "-")}:ctx${Math.round(wanted / 1024)}k`;
  const exists = await postJson(doFetch, `${base}/api/show`, { model: derived });
  if (exists) return derived;
  const created = await postJson<{ status?: string }>(doFetch, `${base}/api/create`, {
    model: derived,
    from: name,
    parameters: { num_ctx: wanted },
    stream: false,
  });
  return created?.status === "success" ? derived : name;
}

function contextOf(modelInfo: Record<string, unknown> | undefined): number | undefined {
  for (const [key, value] of Object.entries(modelInfo ?? {})) {
    if (key.endsWith(".context_length") && typeof value === "number") return value;
  }
  return undefined;
}

/** Discovery must stay quick: a local server answers in milliseconds or is not there. */
const DISCOVERY_TIMEOUT_MS = 1_500;

type Fetched<T> = { status: "ok"; data: T } | { status: "http" } | { status: "unreachable" };

async function fetchJson<T>(doFetch: Fetch, url: string): Promise<Fetched<T>> {
  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) });
    if (!res.ok) return { status: "http" };
    return { status: "ok", data: (await res.json()) as T };
  } catch {
    return { status: "unreachable" };
  }
}

async function getJson<T>(doFetch: Fetch, url: string): Promise<T | undefined> {
  const res = await fetchJson<T>(doFetch, url);
  return res.status === "ok" ? res.data : undefined;
}

async function postJson<T = unknown>(
  doFetch: Fetch,
  url: string,
  body: unknown,
): Promise<T | undefined> {
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}
