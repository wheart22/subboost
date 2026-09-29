import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

type HyperdriveBinding = { connectionString?: string };
type CloudflareEnvironment = { HYPERDRIVE?: HyperdriveBinding };

const LOCAL_DEVELOPMENT_DATABASE_URL =
  "postgresql://subboost_local_dev:subboost_local_dev_password@localhost:5432/subboost_local_dev?schema=public";

const globalForPrisma = globalThis as unknown as {
  localPrismaByUrl?: Map<string, PrismaClient>;
};

function createClient(connectionString: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

async function getConnectionString(): Promise<string> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = await getCloudflareContext({ async: true });
    const hyperdrive = (context.env as CloudflareEnvironment | undefined)?.HYPERDRIVE;
    if (hyperdrive?.connectionString) return hyperdrive.connectionString;
  } catch {
    // Local Node.js and GitHub Actions use DATABASE_URL directly.
  }

  const configured = process.env.DATABASE_URL?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    return LOCAL_DEVELOPMENT_DATABASE_URL;
  }
  throw new Error("HYPERDRIVE or DATABASE_URL must be configured.");
}

async function getPrismaClient(): Promise<PrismaClient> {
  const connectionString = await getConnectionString();
  const clients = (globalForPrisma.localPrismaByUrl ??= new Map());
  const existing = clients.get(connectionString);
  if (existing) return existing;

  const client = createClient(connectionString);
  clients.set(connectionString, client);
  return client;
}

function createPrismaProxy(): PrismaClient {
  const delegates = new Map<PropertyKey, object>();
  return new Proxy(Object.create(null) as PrismaClient, {
    get(_target, property) {
      if (property === "then") return undefined;
      if (typeof property === "symbol") return undefined;
      if (property.startsWith("$")) {
        return async (...args: unknown[]) => {
          const client = await getPrismaClient();
          const operation = (client as unknown as Record<string, unknown>)[property];
          if (typeof operation !== "function") {
            throw new Error(`Prisma client method ${property} is unavailable.`);
          }
          return Reflect.apply(operation, client, args);
        };
      }
      if (!delegates.has(property)) {
        const delegate = new Proxy(Object.create(null) as object, {
          get(_delegateTarget, method) {
            if (method === "then") return undefined;
            if (typeof method === "symbol") return undefined;
            return async (...args: unknown[]) => {
              const client = await getPrismaClient();
              const value = (client as unknown as Record<string, unknown>)[property];
              if (typeof value === "function") return Reflect.apply(value, client, args);
              if (!value || typeof value !== "object") {
                throw new Error(`Prisma client method ${property} is unavailable.`);
              }
              const operation = (value as Record<string, unknown>)[method];
              if (typeof operation !== "function") {
                throw new Error(`Prisma delegate method ${property}.${method} is unavailable.`);
              }
              return Reflect.apply(operation, value, args);
            };
          },
        });
        delegates.set(property, delegate);
      }
      return delegates.get(property);
    },
  });
}

/**
 * In a Worker the binding is request context, so this proxy resolves the Prisma
 * client after the request starts. This also avoids reading Worker bindings
 * while the module is being initialized, before a request context exists.
 * Node.js tools use DATABASE_URL and reuse the client by connection string.
 */
export const prisma = createPrismaProxy();

export async function getPrisma(): Promise<PrismaClient> {
  return getPrismaClient();
}

