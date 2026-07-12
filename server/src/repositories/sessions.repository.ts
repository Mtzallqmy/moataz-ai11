import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { database } from '../database/client.js';
import { refreshTokens, users } from '../database/schema.js';

export type SessionRecord = {
  id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  last_used_at: string | null;
  user_agent: string | null;
  ip_hash: string | null;
};

export type RefreshUserRecord = {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: string;
  is_active: boolean;
  refresh_id: string;
};

export const sessionsRepository = {
  async create(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: string;
    userAgent: string | null;
    ipHash: string | null;
  }): Promise<void> {
    await database.insert(refreshTokens).values({
      id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      userAgent: input.userAgent,
      ipHash: input.ipHash
    });
  },

  async findValidByHash(tokenHash: string): Promise<RefreshUserRecord | undefined> {
    const [row] = await database.select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      refreshId: refreshTokens.id
    }).from(refreshTokens)
      .innerJoin(users, eq(users.id, refreshTokens.userId))
      .where(and(
        eq(refreshTokens.tokenHash, tokenHash),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, sql`CURRENT_TIMESTAMP`)
      ))
      .limit(1);
    if (!row) return undefined;
    return {
      id: row.id,
      email: row.email,
      password_hash: row.passwordHash,
      name: row.name,
      role: row.role,
      is_active: row.isActive,
      refresh_id: row.refreshId
    };
  },

  async rotate(input: {
    oldId: string;
    nextId: string;
    userId: string;
    tokenHash: string;
    expiresAt: string;
    userAgent: string | null;
    ipHash: string | null;
  }): Promise<void> {
    await database.transaction(async (tx) => {
      await tx.update(refreshTokens).set({
        revokedAt: sql`CURRENT_TIMESTAMP`,
        lastUsedAt: sql`CURRENT_TIMESTAMP`
      }).where(and(eq(refreshTokens.id, input.oldId), isNull(refreshTokens.revokedAt)));
      await tx.insert(refreshTokens).values({
        id: input.nextId,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent,
        ipHash: input.ipHash
      });
    });
  },

  async revokeByHash(tokenHash: string): Promise<void> {
    await database.update(refreshTokens).set({ revokedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)));
  },

  async listActive(userId: string): Promise<SessionRecord[]> {
    const rows = await database.select().from(refreshTokens)
      .where(and(
        eq(refreshTokens.userId, userId),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, sql`CURRENT_TIMESTAMP`)
      ))
      .orderBy(desc(refreshTokens.createdAt));
    return rows.map((row) => ({
      id: row.id,
      token_hash: row.tokenHash,
      expires_at: row.expiresAt,
      created_at: row.createdAt,
      last_used_at: row.lastUsedAt,
      user_agent: row.userAgent,
      ip_hash: row.ipHash
    }));
  },

  async findOwnedActive(userId: string, id: string): Promise<{ token_hash: string } | undefined> {
    const [row] = await database.select({ tokenHash: refreshTokens.tokenHash }).from(refreshTokens)
      .where(and(eq(refreshTokens.id, id), eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
      .limit(1);
    return row ? { token_hash: row.tokenHash } : undefined;
  },

  async revokeOwned(userId: string, id: string): Promise<void> {
    await database.update(refreshTokens).set({ revokedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(refreshTokens.id, id), eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  },

  async revokeOthers(userId: string, currentHash: string): Promise<void> {
    const condition = currentHash
      ? and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt), ne(refreshTokens.tokenHash, currentHash))
      : and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt));
    await database.update(refreshTokens).set({ revokedAt: sql`CURRENT_TIMESTAMP` }).where(condition);
  },

  async revokeAll(userId: string): Promise<void> {
    await database.update(refreshTokens).set({ revokedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  },

  async purgeExpired(): Promise<number> {
    const rows = await database.delete(refreshTokens)
      .where(sql`${refreshTokens.expiresAt} <= CURRENT_TIMESTAMP OR ${refreshTokens.revokedAt} IS NOT NULL`)
      .returning({ id: refreshTokens.id });
    return rows.length;
  }
};
