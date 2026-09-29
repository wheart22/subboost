import { getPrisma } from "../src/lib/prisma";
import { syncAllConfigurationSnapshots } from "./config-kv-sync";

const prisma = await getPrisma();
try {
  const result = await syncAllConfigurationSnapshots();
  console.log(`Configuration snapshots synced: ${result.synced}; stale keys removed: ${result.removed}.`);
} finally {
  await prisma.$disconnect();
}
