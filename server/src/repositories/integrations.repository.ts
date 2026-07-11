import { and, desc, eq, sql } from 'drizzle-orm';
import { database } from '../database/client.js';
import { integrations } from '../database/schema.js';

export type IntegrationRecord = {
  id: string;
  user_id: string;
  type: string;
  name: string;
  token_enc: string;
  meta: Record<string, unknown>;
  validation_status: string;
  validation_error_code: string | null;
  validated_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function record(row: typeof integrations.$inferSelect): IntegrationRecord {
  return {
    id: row.id,
    user_id: row.userId,
    type: row.type,
    name: row.name,
    token_enc: row.encryptedToken,
    meta: row.meta,
    validation_status: row.validationStatus,
    validation_error_code: row.validationErrorCode,
    validated_at: row.validatedAt,
    is_active: row.isActive,
    created_at: row.createdAt,
    updated_at: row.updatedAt
  };
}

export const integrationsRepository = {
  async listForUser(userId: string): Promise<IntegrationRecord[]> {
    const rows = await database.select().from(integrations)
      .where(and(eq(integrations.userId, userId), eq(integrations.isActive, true)))
      .orderBy(desc(integrations.createdAt));
    return rows.map(record);
  },

  async listVerified(userId: string): Promise<IntegrationRecord[]> {
    const rows = await database.select().from(integrations)
      .where(and(
        eq(integrations.userId, userId),
        eq(integrations.isActive, true),
        eq(integrations.validationStatus, 'verified')
      ));
    return rows.map(record);
  },

  async listAllVerifiedByType(type: string): Promise<IntegrationRecord[]> {
    const rows = await database.select().from(integrations)
      .where(and(eq(integrations.type, type), eq(integrations.isActive, true), eq(integrations.validationStatus, 'verified')));
    return rows.map(record);
  },

  async findOwned(userId: string, id: string): Promise<IntegrationRecord | undefined> {
    const [row] = await database.select().from(integrations)
      .where(and(eq(integrations.id, id), eq(integrations.userId, userId), eq(integrations.isActive, true)))
      .limit(1);
    return row ? record(row) : undefined;
  },

  async create(input: {
    id: string;
    userId: string;
    type: string;
    name: string;
    encryptedToken: string;
    meta: Record<string, unknown>;
  }): Promise<IntegrationRecord> {
    const [row] = await database.insert(integrations).values({
      id: input.id,
      userId: input.userId,
      type: input.type,
      name: input.name,
      encryptedToken: input.encryptedToken,
      meta: input.meta,
      legacyMeta: JSON.stringify(input.meta),
      validationStatus: 'untested',
      isActive: true
    }).returning();
    return record(row!);
  },

  async update(userId: string, id: string, input: {
    name: string;
    encryptedToken: string;
    meta: Record<string, unknown>;
  }): Promise<IntegrationRecord | undefined> {
    const [row] = await database.update(integrations).set({
      name: input.name,
      encryptedToken: input.encryptedToken,
      meta: input.meta,
      legacyMeta: JSON.stringify(input.meta),
      validationStatus: 'untested',
      validationErrorCode: null,
      validatedAt: null,
      updatedAt: sql`CURRENT_TIMESTAMP`
    }).where(and(eq(integrations.id, id), eq(integrations.userId, userId), eq(integrations.isActive, true))).returning();
    return row ? record(row) : undefined;
  },

  async updateMeta(userId: string, id: string, meta: Record<string, unknown>): Promise<void> {
    await database.update(integrations).set({
      meta,
      legacyMeta: JSON.stringify(meta),
      updatedAt: sql`CURRENT_TIMESTAMP`
    }).where(and(eq(integrations.id, id), eq(integrations.userId, userId), eq(integrations.isActive, true)));
  },

  async setValidation(userId: string, id: string, input: { status: 'verified' | 'failed'; errorCode?: string | null; meta?: Record<string, unknown> }): Promise<void> {
    await database.update(integrations).set({
      validationStatus: input.status,
      validationErrorCode: input.errorCode ?? null,
      validatedAt: sql`CURRENT_TIMESTAMP`,
      ...(input.meta ? { meta: input.meta, legacyMeta: JSON.stringify(input.meta) } : {}),
      updatedAt: sql`CURRENT_TIMESTAMP`
    }).where(and(eq(integrations.id, id), eq(integrations.userId, userId), eq(integrations.isActive, true)));
  },

  async disable(userId: string, id: string): Promise<boolean> {
    const rows = await database.update(integrations).set({ isActive: false, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(integrations.id, id), eq(integrations.userId, userId), eq(integrations.isActive, true)))
      .returning({ id: integrations.id });
    return rows.length > 0;
  },

  async countForUser(userId: string): Promise<{ total: number; verified: number }> {
    const rows = await database.select({
      status: integrations.validationStatus,
      count: sql<number>`count(*)::int`
    }).from(integrations)
      .where(and(eq(integrations.userId, userId), eq(integrations.isActive, true)))
      .groupBy(integrations.validationStatus);
    return {
      total: rows.reduce((sum, row) => sum + row.count, 0),
      verified: rows.filter((row) => row.status === 'verified').reduce((sum, row) => sum + row.count, 0)
    };
  }
};
