import { and, desc, eq, sql } from 'drizzle-orm';
import { database } from '../database/client.js';
import { chats, providers } from '../database/schema.js';

export type ChatMode = 'chat' | 'agent' | 'multi-agent';
export type ChatRecord = {
  id: string;
  user_id: string;
  title: string;
  provider_id: string | null;
  model: string | null;
  mode: ChatMode;
  project_id: string | null;
  created_at: string;
  updated_at: string;
};

function record(row: typeof chats.$inferSelect): ChatRecord {
  return {
    id: row.id,
    user_id: row.userId,
    title: row.title,
    provider_id: row.providerId,
    model: row.model,
    mode: row.mode as ChatMode,
    project_id: row.projectId,
    created_at: row.createdAt,
    updated_at: row.updatedAt
  };
}

export const chatsRepository = {
  async listForUser(userId: string) {
    const rows = await database.select({
      chat: chats,
      providerName: providers.name,
      providerType: providers.providerType,
      providerReady: providers.isReady
    }).from(chats)
      .leftJoin(providers, and(
        eq(providers.id, chats.providerId),
        eq(providers.userId, chats.userId),
        eq(providers.legacyIsActive, true)
      ))
      .where(eq(chats.userId, userId))
      .orderBy(desc(chats.updatedAt));
    return rows.map((row) => ({
      ...record(row.chat),
      provider_name: row.providerName,
      provider_type: row.providerType,
      provider_available: row.providerReady === true
    }));
  },

  async findOwned(userId: string, id: string): Promise<ChatRecord | undefined> {
    const [row] = await database.select().from(chats).where(and(eq(chats.id, id), eq(chats.userId, userId))).limit(1);
    return row ? record(row) : undefined;
  },

  async create(input: {
    id: string;
    userId: string;
    title: string;
    providerId: string | null;
    model: string | null;
    mode: ChatMode;
    projectId?: string | null;
  }): Promise<ChatRecord> {
    const [row] = await database.insert(chats).values({
      id: input.id,
      userId: input.userId,
      title: input.title,
      providerId: input.providerId,
      model: input.model,
      mode: input.mode,
      projectId: input.projectId ?? null
    }).returning();
    return record(row!);
  },

  async update(userId: string, id: string, input: {
    title: string;
    providerId: string | null;
    model: string | null;
    mode: ChatMode;
  }): Promise<ChatRecord | undefined> {
    const [row] = await database.update(chats).set({
      title: input.title,
      providerId: input.providerId,
      model: input.model,
      mode: input.mode,
      updatedAt: sql`CURRENT_TIMESTAMP`
    }).where(and(eq(chats.id, id), eq(chats.userId, userId))).returning();
    return row ? record(row) : undefined;
  },

  async setProviderModel(userId: string, id: string, providerId: string, model: string): Promise<void> {
    await database.update(chats).set({ providerId, model, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(chats.id, id), eq(chats.userId, userId)));
  },

  async clearProvider(userId: string, providerId: string): Promise<void> {
    await database.update(chats).set({ providerId: null, model: null, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(chats.userId, userId), eq(chats.providerId, providerId)));
  },

  async touchAndSetInitialTitle(userId: string, id: string, title: string): Promise<void> {
    await database.update(chats).set({
      updatedAt: sql`CURRENT_TIMESTAMP`,
      title: sql`CASE WHEN ${chats.title} = 'New chat' THEN ${title} ELSE ${chats.title} END`
    }).where(and(eq(chats.id, id), eq(chats.userId, userId)));
  },

  async delete(userId: string, id: string): Promise<boolean> {
    const rows = await database.delete(chats).where(and(eq(chats.id, id), eq(chats.userId, userId))).returning({ id: chats.id });
    return rows.length > 0;
  }
};
