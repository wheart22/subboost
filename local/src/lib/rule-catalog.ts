import "server-only";

import { createRuleCatalogService } from "@subboost/server-core/rules";
import type { RemoteRuleIndex } from "@subboost/server-core/rules";
import { getCloudflareKvBinding, isCloudflareDeployment } from "@local/lib/cloudflare-bindings";

const RULE_INDEX_KEY = "remote-index-v1";

async function loadPersistedRuleIndex(): Promise<RemoteRuleIndex | null> {
  const namespace = await getCloudflareKvBinding("RULES_KV");
  if (!namespace) return null;
  const raw = await namespace.get(RULE_INDEX_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RemoteRuleIndex;
  } catch {
    return null;
  }
}

async function savePersistedRuleIndex(index: RemoteRuleIndex): Promise<void> {
  const namespace = await getCloudflareKvBinding("RULES_KV");
  if (namespace) await namespace.put(RULE_INDEX_KEY, JSON.stringify(index));
}

export const localRuleCatalogService = createRuleCatalogService({
  getGitHubToken: () => process.env.GITHUB_TOKEN,
  loadCachedIndex: loadPersistedRuleIndex,
  saveCachedIndex: savePersistedRuleIndex,
  refreshOnRequest: !isCloudflareDeployment(),
  logger: console,
});

export const searchRules = localRuleCatalogService.searchRules;
export const refreshRuleIndex = localRuleCatalogService.refreshRuleIndex;
export const getCnRuleCandidateDiscovery = localRuleCatalogService.getCnRuleCandidateDiscovery;
