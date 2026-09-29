import { decryptEncryptedFieldV2WebCrypto } from "../../../packages/server-core/src/crypto/webcrypto";

interface ConfigSnapshot {
  version: 1;
  encryptedYaml: string;
  generatedAt: string;
  sha256: string;
  name: string;
  subscriptionInfo?: Record<string, unknown>;
  autoUpdateIntervalSeconds?: number | null;
}

interface KvNamespace {
  get(key: string): Promise<string | null>;
}

interface Environment {
  CONFIG_KV: KvNamespace;
  ENCRYPTION_KEY: string;
}

function jsonNotFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function contentDisposition(rawName: string): string {
  const safeName = rawName.replace(/[\r\n"]/g, "").replace(/\.(?:ya?ml)$/i, "").slice(0, 80) || "config";
  const asciiName = safeName.replace(/[^\x20-\x7E]+/g, "").replace(/[<>:"/\\|?*]+/g, "").trim().replace(/\s+/g, "_").slice(0, 60) || "config";
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

function subscriptionHeaders(snapshot: ConfigSnapshot): Headers {
  const headers = new Headers({
    "content-type": "text/yaml;charset=utf-8",
    "content-disposition": contentDisposition(snapshot.name),
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  const info = snapshot.subscriptionInfo ?? {};
  const usage = ["upload", "download", "total", "expire"]
    .filter((key) => typeof info[key] === "number" && Number.isFinite(info[key]))
    .map((key) => `${key}=${info[key]}`)
    .join("; ");
  if (usage) headers.set("subscription-userinfo", usage);
  const webPageUrl = info.profileWebPageUrl ?? info["profile-web-page-url"];
  if (typeof webPageUrl === "string" && /^https?:\/\//i.test(webPageUrl)) {
    headers.set("profile-web-page-url", webPageUrl.replace(/[\r\n]/g, "").slice(0, 1024));
  }
  const planName = info.planName ?? info["plan-name"];
  if (typeof planName === "string" && planName.trim()) {
    headers.set("plan-name", planName.replace(/[\r\n]/g, " ").slice(0, 200));
  }
  const interval = Math.max(3600, Number(snapshot.autoUpdateIntervalSeconds) || 0);
  headers.set("profile-update-interval", String(Math.ceil(interval / 3600)));
  return headers;
}

async function toHex(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, HEAD, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "86400",
        },
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });

    const match = new URL(request.url).pathname.match(/^\/subscriptions\/([A-Za-z0-9_-]{20,80})\/config\.yaml$/);
    if (!match) return jsonNotFound();

    const raw = await env.CONFIG_KV.get(match[1]);
    if (!raw) return jsonNotFound();

    try {
      const snapshot = JSON.parse(raw) as ConfigSnapshot;
      if (snapshot.version !== 1 || typeof snapshot.encryptedYaml !== "string" || !/^[0-9a-f]{64}$/i.test(snapshot.sha256)) {
        return jsonNotFound();
      }
      const yaml = await decryptEncryptedFieldV2WebCrypto(snapshot.encryptedYaml, env.ENCRYPTION_KEY);
      const digest = await toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(yaml)));
      if (digest !== snapshot.sha256.toLowerCase()) return jsonNotFound();
      const headers = subscriptionHeaders(snapshot);
      return new Response(request.method === "HEAD" ? null : yaml, { status: 200, headers });
    } catch {
      return jsonNotFound();
    }
  },
};
