import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';

export interface WorkerEnv {
  DATABASE_URL: string;
  JWT_SECRET: string;
  CORS_ORIGIN?: string;
  TASKS_MAINTENANCE?: string;
}

/**
 * Workers do not share a reliable long-lived process. Create the Prisma client
 * from the request's Neon connection string instead of reading process.env.
 */
export function createPrisma(databaseUrl: string): PrismaClient {
  const adapter = new PrismaNeon({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

/**
 * Close a request-scoped client after the response without putting WebSocket
 * pool teardown on the production response path. Hono's app.request tests do
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
