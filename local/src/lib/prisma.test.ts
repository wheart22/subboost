import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  PrismaClient: vi.fn(),
  PrismaPg: vi.fn(),
  getCloudflareContext: vi.fn(),
}));

async function loadPrismaModule(
  env: { DATABASE_URL?: string; NODE_ENV?: string },
  cloudflareEnvironment?: Record<string, unknown>,
) {
  vi.resetModules();
  vi.doMock("@prisma/adapter-pg", () => ({ PrismaPg: mocks.PrismaPg }));
  vi.doMock("@prisma/client", () => ({ PrismaClient: mocks.PrismaClient }));
  vi.doMock("@opennextjs/cloudflare", () => ({ getCloudflareContext: mocks.getCloudflareContext }));

  vi.stubEnv("DATABASE_URL", env.DATABASE_URL);
  vi.stubEnv("NODE_ENV", env.NODE_ENV);
  vi.stubEnv("SUBBOOST_CLOUDFLARE", "false");
  delete (globalThis as { localPrismaByUrl?: unknown }).localPrismaByUrl;

  if (cloudflareEnvironment) {
    mocks.getCloudflareContext.mockResolvedValue({ env: cloudflareEnvironment });
  } else {
    mocks.getCloudflareContext.mockRejectedValue(new Error("No Cloudflare request context"));
  }

  return import("./prisma");
}

describe("request-scoped Prisma client", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.PrismaPg.mockImplementation(function PrismaPg(this: { adapterOptions: unknown }, options: unknown) {
      this.adapterOptions = options;
    });
    mocks.PrismaClient.mockImplementation(function PrismaClient(this: { clientOptions: unknown }, options: unknown) {
      this.clientOptions = options;
    });
  });

  afterEach(() => {
    vi.stubEnv("DATABASE_URL", originalDatabaseUrl);
    vi.stubEnv("NODE_ENV", originalNodeEnv);
    vi.unstubAllEnvs();
    delete (globalThis as { localPrismaByUrl?: unknown }).localPrismaByUrl;
    vi.doUnmock("@prisma/adapter-pg");
    vi.doUnmock("@prisma/client");
    vi.doUnmock("@opennextjs/cloudflare");
  });

  it("resolves Hyperdrive after the Worker request context is available", async () => {
    const mod = await loadPrismaModule(
      { NODE_ENV: "production" },
      { HYPERDRIVE: { connectionString: "postgresql://hyperdrive.example/db" } },
    );

    expect(mocks.PrismaClient).not.toHaveBeenCalled();
    await mod.getPrisma();

    expect(mocks.PrismaPg).toHaveBeenCalledWith({ connectionString: "postgresql://hyperdrive.example/db" });
    expect(mocks.PrismaClient).toHaveBeenCalledWith({
      adapter: expect.objectContaining({
        adapterOptions: { connectionString: "postgresql://hyperdrive.example/db" },
      }),
      log: ["error"],
    });
  });

  it("uses and reuses the configured database URL in Node.js", async () => {
    const mod = await loadPrismaModule({ DATABASE_URL: " postgresql://local.example/db ", NODE_ENV: "development" });

    const first = await mod.getPrisma();
    const second = await mod.getPrisma();

    expect(first).toBe(second);
    expect(mocks.PrismaPg).toHaveBeenCalledWith({ connectionString: "postgresql://local.example/db" });
    expect(mocks.PrismaClient).toHaveBeenCalledTimes(1);
    expect(mocks.PrismaClient).toHaveBeenCalledWith({
      adapter: expect.objectContaining({ adapterOptions: { connectionString: "postgresql://local.example/db" } }),
      log: ["warn", "error"],
    });
  });

  it("fails clearly in production when neither Hyperdrive nor DATABASE_URL is configured", async () => {
    const mod = await loadPrismaModule({ DATABASE_URL: "   ", NODE_ENV: "production" });

    await expect(mod.getPrisma()).rejects.toThrow("HYPERDRIVE or DATABASE_URL must be configured.");
    expect(mocks.PrismaClient).not.toHaveBeenCalled();
  });
});

