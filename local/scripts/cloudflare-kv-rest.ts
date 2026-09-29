type CloudflareKvApiConfig = {
  accountId: string;
  apiToken: string;
};

function getConfig(): CloudflareKvApiConfig {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken) throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.");
  return { accountId, apiToken };
}

function getNamespaceId(kind: "config" | "rules"): string {
  const value = kind === "config"
    ? process.env.CONFIG_KV_NAMESPACE_ID
    : process.env.RULES_KV_NAMESPACE_ID;
  if (!value?.trim()) throw new Error(`${kind.toUpperCase()}_KV_NAMESPACE_ID is required.`);
  return value.trim();
}

function namespaceUrl(namespaceId: string, suffix = ""): string {
  const { accountId } = getConfig();
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}${suffix}`;
}

async function requestCloudflare(url: string, init: RequestInit = {}): Promise<unknown> {
  const { apiToken } = getConfig();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: unknown;
    result_info?: { cursor?: string };
  };
  if (!response.ok || payload.success === false) {
    const detail = payload.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(`Cloudflare KV request failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return payload;
}

export async function putCloudflareKvValue(kind: "config" | "rules", key: string, value: string): Promise<void> {
  const namespaceId = getNamespaceId(kind);
  await requestCloudflare(namespaceUrl(namespaceId, `/values/${encodeURIComponent(key)}`), {
    method: "PUT",
    body: value,
    headers: { "content-type": "application/octet-stream" },
  });
}

export async function listCloudflareKvKeys(kind: "config" | "rules"): Promise<string[]> {
  const namespaceId = getNamespaceId(kind);
  const names: string[] = [];
  let cursor = "";
  do {
    const params = new URLSearchParams({ limit: "1000" });
    if (cursor) params.set("cursor", cursor);
    const payload = await requestCloudflare(namespaceUrl(namespaceId, `/keys?${params}`)) as {
      result?: Array<{ name?: string }>;
      result_info?: { cursor?: string };
    };
    for (const item of payload.result ?? []) if (typeof item.name === "string") names.push(item.name);
    cursor = payload.result_info?.cursor ?? "";
  } while (cursor);
  return names;
}

export async function deleteCloudflareKvValue(kind: "config" | "rules", key: string): Promise<void> {
  const namespaceId = getNamespaceId(kind);
  await requestCloudflare(namespaceUrl(namespaceId, `/values/${encodeURIComponent(key)}`), { method: "DELETE" });
}

export async function removeStaleCloudflareKvKeys(kind: "config" | "rules", retained: ReadonlySet<string>): Promise<number> {
  const keys = await listCloudflareKvKeys(kind);
  let deleted = 0;
  for (const key of keys) {
    if (retained.has(key)) continue;
    await deleteCloudflareKvValue(kind, key);
    deleted += 1;
  }
  return deleted;
}

export async function fetchCloudflareWorkersSubdomain(): Promise<string> {
  const { accountId } = getConfig();
  const payload = await requestCloudflare(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/subdomain`,
  ) as { result?: { subdomain?: string } };
  const subdomain = payload.result?.subdomain?.trim();
  if (!subdomain) throw new Error("Cloudflare Workers subdomain is not enabled. Enable a workers.dev subdomain in the Cloudflare dashboard first.");
  return subdomain;
}
