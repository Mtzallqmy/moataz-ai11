import { eq, sql } from 'drizzle-orm';
import { database } from '../database/client.js';
import { users } from '../database/schema.js';

export type UserRecord = {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

function record(row: typeof users.$inferSelect): UserRecord {
  return {
    id: row.id,
    email: row.email,
    password_hash: row.passwordHash,
    name: row.name,
    role: row.role,
    is_active: row.isActive,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    last_login_at: row.lastLoginAt
  };
}

export const usersRepository = {
  async findById(id: string): Promise<UserRecord | undefined> {
    const [row] = await database.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? record(row) : undefined;
  },

  async findByEmail(email: string): Promise<UserRecord | undefined> {
    const [row] = await database.select().from(users).where(eq(users.email, email)).limit(1);
    return row ? record(row) : undefined;
  },

  async create(input: {
    id: string;
    email: string;
    passwordHash: string;
    name: string;
    role: 'admin' | 'user';
    isActive?: boolean;
  }): Promise<UserRecord> {
    const [row] = await database.insert(users).values({
      id: input.id,
      email: input.email,
      passwordHash: input.passwordHash,
      name: input.name,
      role: input.role,
      isActive: input.isActive ?? true
    }).returning();
    return record(row!);
  },

  async markLogin(id: string): Promise<void> {
    await database.update(users).set({
      lastLoginAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    }).where(eq(users.id, id));
  },

  async setActive(id: string, isActive: boolean): Promise<void> {
    await database.update(users).set({ isActive, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(users.id, id));
  }
};
