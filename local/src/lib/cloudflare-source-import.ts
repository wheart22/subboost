const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;

export type CloudflareSourceTextResult =
  | { ok: true; content: string; headers: Record<string, string>; responseStatus: number }
  | { ok: false; error: string; status: number };

function normalizeHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => { result[key.toLowerCase()] = value; });
  return result;
}

function validateUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("只支持 HTTP 或 HTTPS 订阅 URL");
  if (url.username || url.password) throw new Error("订阅 URL 不允许包含用户名或密码");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("禁止访问本机或内网地址");
  }
  return url;
}

async function readBodyLimited(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_BYTES) {
    await response.body?.cancel();
    throw new Error("订阅响应超过 5 MiB 限制");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SOURCE_BYTES) {
      await reader.cancel("response too large").catch(() => undefined);
      throw new Error("订阅响应超过 5 MiB 限制");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(bytes);
}

async function fetchText(rawUrl: string, signal: AbortSignal): Promise<CloudflareSourceTextResult> {
  let currentUrl: URL;
  try {
    currentUrl = validateUrl(rawUrl);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "无效的订阅 URL", status: 400 };
  }

  try {
    let response: Response | null = null;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      validateUrl(currentUrl.toString());
      response = await fetch(currentUrl, {
        headers: {
          "User-Agent": "SubBoost",
          Accept: "text/plain, application/yaml, application/x-yaml, */*;q=0.8",
          "Cache-Control": "no-cache",
        },
        redirect: "manual",
        signal,
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) {
        return { ok: false, error: "订阅重定向次数过多", status: 310 };
      }
      await response.body?.cancel().catch(() => undefined);
      currentUrl = validateUrl(new URL(location, currentUrl).toString());
      response = null;
    }
    if (!response) return { ok: false, error: "订阅重定向次数过多", status: 310 };
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, error: `HTTP ${response.status}`, status: response.status };
    }
    const headers = normalizeHeaders(response.headers);
    const content = await readBodyLimited(response);
    return { ok: true, content, headers, responseStatus: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取订阅内容失败";
    return { ok: false, error: message, status: message.includes("5 MiB") ? 413 : 400 };
  }
}

export async function fetchPublicSubscriptionText(rawUrl: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchText(rawUrl, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
