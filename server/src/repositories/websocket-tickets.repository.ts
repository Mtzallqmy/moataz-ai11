import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { database } from '../database/client.js';
import { users, websocketTickets } from '../database/schema.js';

export const websocketTicketsRepository = {
  async create(input: { id: string; tokenHash: string; userId: string; purpose: string; expiresAt: string }): Promise<void> {
    await database.insert(websocketTickets).values({
      id: input.id,
      tokenHash: input.tokenHash,
      userId: input.userId,
      purpose: input.purpose,
      expiresAt: input.expiresAt
    });
  },

  async consume(tokenHash: string, purpose: string): Promise<{
    id: string;
    email: string;
    name: string;
    role: string;
    is_active: boolean;
  } | undefined> {
    return database.transaction(async (tx) => {
      const [ticket] = await tx.update(websocketTickets).set({ usedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(
          eq(websocketTickets.tokenHash, tokenHash),
          eq(websocketTickets.purpose, purpose),
          isNull(websocketTickets.usedAt),
          gt(websocketTickets.expiresAt, sql`CURRENT_TIMESTAMP`)
        ))
        .returning({ userId: websocketTickets.userId });
      if (!ticket) return undefined;
      const [user] = await tx.select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        isActive: users.isActive
      }).from(users).where(eq(users.id, ticket.userId)).limit(1);
      return user ? {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        is_active: user.isActive
      } : undefined;
    });
  },

  async purge(): Promise<number> {
    const rows = await database.delete(websocketTickets)
      .where(sql`${websocketTickets.expiresAt} <= CURRENT_TIMESTAMP OR ${websocketTickets.usedAt} IS NOT NULL`)
      .returning({ id: websocketTickets.id });
    return rows.length;
  }
};
