export type CloudflareKvNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

type CloudflareBindings = Record<string, unknown> & {
  HYPERDRIVE?: { connectionString?: string };
  CONFIG_KV?: CloudflareKvNamespace;
  RULES_KV?: CloudflareKvNamespace;
};

export async function getCloudflareBindings(): Promise<CloudflareBindings | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = await getCloudflareContext({ async: true });
    return context.env as CloudflareBindings;
  } catch {
    return null;
  }
}

export async function getCloudflareKvBinding(name: "CONFIG_KV" | "RULES_KV") {
  return (await getCloudflareBindings())?.[name] ?? null;
}

export function isCloudflareDeployment(): boolean {
  return process.env.SUBBOOST_CLOUDFLARE === "true";
}
