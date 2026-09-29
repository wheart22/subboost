import { prisma } from "./prisma";
import { isCloudflareDeployment } from "./cloudflare-bindings";
import { readSession } from "./session";

export type CurrentAdmin = {
  id: string;
  username: string;
};

/** The Cloudflare management Worker uses one owner and a password-backed session. */
export async function getCurrentAdmin(): Promise<CurrentAdmin | null> {
  if (isCloudflareDeployment()) {
    const session = await readSession();
    if (!session) return null;
    return prisma.localAdmin.findFirst({
      where: { id: session.adminId },
      select: { id: true, username: true },
    });
  }

  const session = await readSession();
  if (!session) return null;
  return prisma.localAdmin.findUnique({
    where: { id: session.adminId },
    select: { id: true, username: true },
  });
}

export async function isSetupRequired(): Promise<boolean> {
  if (isCloudflareDeployment()) return false;
  return (await prisma.localAdmin.count()) === 0;
}
