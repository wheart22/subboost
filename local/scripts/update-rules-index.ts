import { createRuleCatalogService } from "@subboost/server-core/rules";
import { putCloudflareKvValue } from "./cloudflare-kv-rest";

const service = createRuleCatalogService({
  getGitHubToken: () => process.env.GITHUB_TOKEN,
  logger: console,
});
const result = await service.refreshRuleIndex({ force: true });
if (!result.index) throw new Error(result.error || "Unable to refresh the rule index.");
await putCloudflareKvValue("rules", "remote-index-v1", JSON.stringify(result.index));
console.log(`Rule index ${result.status}: ${result.index.geosite.length + result.index.geoip.length} entries.`);
