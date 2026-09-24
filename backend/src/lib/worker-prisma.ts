import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export interface WorkerEnv {
  DATABASE_URL: string;
  HYPERDRIVE?: { connectionString: string };
  JWT_SECRET: string;
  CORS_ORIGIN?: string;
  TASKS_MAINTENANCE?: string;
}

/**
 * Workers do not share a reliable long-lived process. Create the Prisma client
 * from the request's connection string instead of reading process.env.
 */
export function createPrisma(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

/**
 * Close a request-scoped client after the response without putting connection
 * teardown on the production response path. Hono's app.request tests do
 * not provide an ExecutionContext, so they deliberately fall back to waiting.
 */
export async function disconnectPrisma(
  context: { executionCtx: { waitUntil(promise: Promise<unknown>): void } },
  prisma: PrismaClient
): Promise<void> {
  try {
    context.executionCtx.waitUntil(prisma.$disconnect());
  } catch {
    await prisma.$disconnect();
  }
}
