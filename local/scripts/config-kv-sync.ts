import { decryptJson, decryptJsonObject, decryptText } from "../src/lib/crypto";
import { encryptGeneratedYaml, getGeneratedYamlDigest, makeStoredConfigSnapshot, validateGeneratedYaml } from "../src/lib/cloudflare-config-snapshots";
import { generateLocalSubscriptionYaml } from "../src/lib/subscription-service";
import { getPrisma } from "../src/lib/prisma";
import type { SubscriptionResponseInfo } from "@subboost/core/subscription/subscription-response-info";
import { putCloudflareKvValue, removeStaleCloudflareKvKeys } from "./cloudflare-kv-rest";

export async function syncAllConfigurationSnapshots(): Promise<{ synced: number; removed: number }> {
  const prisma = await getPrisma();
  const rows = await prisma.subscription.findMany({
    select: {
      id: true,
      token: true,
      name: true,
      autoUpdateInterval: true,
      encryptedNodes: true,
      encryptedConfig: true,
      encryptedSubscriptionInfo: true,
      encryptedGeneratedYaml: true,
      generatedYamlUpdatedAt: true,
      generatedYamlSha256: true,
    },
  });

  const retained = new Set<string>();
  for (const row of rows) {
    let encryptedYaml = row.encryptedGeneratedYaml;
    let generatedAt = row.generatedYamlUpdatedAt ?? new Date();
    let digest = row.generatedYamlSha256;

    if (!encryptedYaml) {
      const config = decryptJsonObject(row.encryptedConfig);
      const nodes = decryptJson(row.encryptedNodes, []);
      const yaml = validateGeneratedYaml(generateLocalSubscriptionYaml(config, nodes));
      const encrypted = encryptGeneratedYaml(yaml);
      encryptedYaml = encrypted.encryptedYaml;
      digest = encrypted.sha256;
      generatedAt = new Date();
      await prisma.subscription.update({
        where: { id: row.id },
        data: {
          encryptedGeneratedYaml: encryptedYaml,
          generatedYamlSha256: digest,
          generatedYamlUpdatedAt: generatedAt,
        },
      });
    }

    const yaml = validateGeneratedYaml(decryptText(encryptedYaml));
    const actualDigest = getGeneratedYamlDigest(yaml);
    if (digest !== actualDigest) {
      digest = actualDigest;
      await prisma.subscription.update({
        where: { id: row.id },
        data: { generatedYamlSha256: digest },
      });
    }

    const token = row.token;
    retained.add(token);
    const snapshot = makeStoredConfigSnapshot({
      token,
      encryptedYaml,
      generatedAt,
      sha256: digest,
      name: row.name,
      subscriptionInfo: decryptJson<SubscriptionResponseInfo>(row.encryptedSubscriptionInfo, {}),
      autoUpdateIntervalSeconds: row.autoUpdateInterval,
    });
    await putCloudflareKvValue("config", token, JSON.stringify(snapshot));
  }

  const removed = await removeStaleCloudflareKvKeys("config", retained);
  return { synced: retained.size, removed };
}
