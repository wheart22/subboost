import { getPrisma } from "../src/lib/prisma";

const prisma = await getPrisma();
try {
  const existing = await prisma.localAdmin.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) {
    console.log(`Using existing owner record (${existing.id}).`);
  } else {
    const owner = await prisma.localAdmin.create({
      data: {
        id: "subboost-owner",
        username: "owner",
        passwordHash: "disabled-by-app-password",
      },
    });
    console.log(`Created single owner record (${owner.id}).`);
  }
} finally {
  await prisma.$disconnect();
}
