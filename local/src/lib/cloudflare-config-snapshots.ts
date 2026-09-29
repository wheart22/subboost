import { createHash } from "node:crypto";
import type { SubscriptionResponseInfo } from "@subboost/core/subscription/subscription-response-info";
import { decryptJson, decryptText, encryptText } from "./crypto";
import { getCloudflareKvBinding, isCloudflareDeployment } from "./cloudflare-bindings";

export const MAX_GENERATED_YAML_BYTES = 2 * 1024 * 1024;

export type ConfigSnapshotMetadata = {
  token: string;
  encryptedYaml: string;
  generatedAt: Date | string;
  sha256: string;
  name: string;
  subscriptionInfo: SubscriptionResponseInfo;
  autoUpdateIntervalSeconds: number | null;
};

export type StoredConfigSnapshot = {
  version: 1;
  encryptedYaml: string;
  generatedAt: string;
  sha256: string;
  name: string;
  subscriptionInfo: SubscriptionResponseInfo;
  autoUpdateIntervalSeconds: number | null;
};

export function getGeneratedYamlDigest(yaml: string): string {
  return createHash("sha256").update(yaml, "utf8").digest("hex");
}

export function validateGeneratedYaml(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Generated YAML is required.");
  }
  if (new TextEncoder().encode(value).byteLength > MAX_GENERATED_YAML_BYTES) {
    throw new Error("Generated YAML cannot exceed 2 MiB.");
  }
  return value;
}

export function encryptGeneratedYaml(yaml: string): { encryptedYaml: string; sha256: string } {
  const normalized = validateGeneratedYaml(yaml);
  return {
    encryptedYaml: encryptText(normalized),
    sha256: getGeneratedYamlDigest(normalized),
  };
}

export function makeStoredConfigSnapshot(metadata: ConfigSnapshotMetadata): StoredConfigSnapshot {
  return {
    version: 1,
    encryptedYaml: metadata.encryptedYaml,
    generatedAt: new Date(metadata.generatedAt).toISOString(),
    sha256: metadata.sha256,
    name: metadata.name,
    subscriptionInfo: metadata.subscriptionInfo,
    autoUpdateIntervalSeconds: metadata.autoUpdateIntervalSeconds,
  };
}

export async function writeConfigSnapshotToWorkerKv(metadata: ConfigSnapshotMetadata): Promise<void> {
  const namespace = await getCloudflareKvBinding("CONFIG_KV");
  if (!namespace) {
    if (isCloudflareDeployment()) throw new Error("CONFIG_KV binding is not configured.");
    return;
  }
  await namespace.put(metadata.token, JSON.stringify(makeStoredConfigSnapshot(metadata)));
}

export async function deleteConfigSnapshotFromWorkerKv(token: string): Promise<void> {
  const namespace = await getCloudflareKvBinding("CONFIG_KV");
  if (!namespace) {
    if (isCloudflareDeployment()) throw new Error("CONFIG_KV binding is not configured.");
    return;
  }
  await namespace.delete(token);
}

export function readDecryptedGeneratedYaml(encryptedYaml: string | null | undefined): string | null {
  if (!encryptedYaml) return null;
  return decryptText(encryptedYaml);
}

export function readEncryptedSnapshotInfo(encryptedValue: string | null | undefined): SubscriptionResponseInfo {
  return decryptJson<SubscriptionResponseInfo>(encryptedValue, {});
}
