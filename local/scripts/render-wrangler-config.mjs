import { readFile, writeFile } from "node:fs/promises";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function subscriptionWorkerUrl() {
  const configured = process.env.SUBSCRIPTION_WORKER_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  const apiToken = required("CLOUDFLARE_API_TOKEN");
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.success || !payload?.result?.subdomain) {
    throw new Error("Enable the Cloudflare workers.dev subdomain for this account, then rerun deployment.");
  }
  return `https://subboost-config.${payload.result.subdomain}.workers.dev`;
}

async function render(mode) {
  const configWorker = mode === "config-worker";
  const templatePath = configWorker
    ? "cloudflare/config-worker/wrangler.jsonc.template"
    : "local/wrangler.jsonc.template";
  const outputPath = configWorker
    ? "cloudflare/config-worker/wrangler.jsonc"
    : "local/wrangler.jsonc";
  let content = await readFile(templatePath, "utf8");
  const values = {
    __CLOUDFLARE_ACCOUNT_ID__: required("CLOUDFLARE_ACCOUNT_ID"),
    __CONFIG_KV_NAMESPACE_ID__: required("CONFIG_KV_NAMESPACE_ID"),
  };
  if (!configWorker) {
    values.__RULES_KV_NAMESPACE_ID__ = required("RULES_KV_NAMESPACE_ID");
    values.__HYPERDRIVE_ID__ = required("HYPERDRIVE_ID");
    values.__SUBSCRIPTION_WORKER_URL__ = await subscriptionWorkerUrl();
  }
  for (const [placeholder, value] of Object.entries(values)) {
    content = content.replaceAll(placeholder, value.replaceAll("\\", "\\\\").replaceAll('"', '\\"'));
  }
  if (/__[A-Z0-9_]+__/.test(content)) throw new Error(`Unresolved placeholder in ${outputPath}.`);
  await writeFile(outputPath, content, "utf8");
  console.log(`Rendered ${outputPath}.`);
}

const mode = process.argv[2];
if (mode !== "config-worker" && mode !== "management") {
  throw new Error("Usage: node local/scripts/render-wrangler-config.mjs config-worker|management");
}
await render(mode);
