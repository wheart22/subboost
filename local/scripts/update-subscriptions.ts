import { runLocalSubscriptionAutoUpdateCron } from "../src/lib/auto-update-service";
import { getPrisma } from "../src/lib/prisma";
import { syncAllConfigurationSnapshots } from "./config-kv-sync";

const prisma = await getPrisma();
try {
  const summary = await runLocalSubscriptionAutoUpdateCron(new Date());
  console.log(JSON.stringify(summary));
  const sync = await syncAllConfigurationSnapshots();
  console.log(`Configuration snapshots synced: ${sync.synced}; stale keys removed: ${sync.removed}.`);
} finally {
  await prisma.$disconnect();
}
