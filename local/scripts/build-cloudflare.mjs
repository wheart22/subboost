import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

function runNpx(args, env) {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const hasWranglerConfig = ["wrangler.toml", "wrangler.json", "wrangler.jsonc"].some((file) =>
  existsSync(resolve(process.cwd(), file))
);
const env = {
  ...process.env,
  SUBBOOST_CLOUDFLARE_BUILD: "1",
  ...(!hasWranglerConfig ? { SKIP_WRANGLER_CONFIG_CHECK: "yes" } : {}),
};
runNpx(["prisma", "generate", "--schema", "prisma/schema.prisma"], env);
runNpx(["opennextjs-cloudflare", "build"], env);
