import crypto from 'node:crypto';
import { config } from './config.js';
import { cryptoId, get, query, run, sha256 } from './db.js';
import type { AuthUser } from './auth.js';

export type TerminalTicketUser = AuthUser;

type TicketUserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: number | boolean;
};

export async function issueTerminalTicket(userId: string): Promise<{ ticket: string; expiresAt: string }> {
  const ticket = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.wsTicketTtlSeconds * 1000).toISOString();
  await run(
    'INSERT INTO websocket_tickets (id, token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?, ?)',
    [cryptoId(), sha256(ticket), userId, 'terminal', expiresAt]
  );
  return { ticket, expiresAt };
}

export async function consumeTerminalTicket(ticket: string): Promise<TerminalTicketUser | undefined> {
  const rows = await query<{ user_id: string }>(
    `UPDATE websocket_tickets
     SET used_at = CURRENT_TIMESTAMP
     WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
     RETURNING user_id`,
    [sha256(ticket), 'terminal']
  );
  const userId = rows[0]?.user_id;
  if (!userId) return undefined;

  const row = await get<TicketUserRow>('SELECT id, email, name, role, is_active FROM users WHERE id = ?', [userId]);
  if (!row || !(row.is_active === true || row.is_active === 1) || row.role !== 'admin') return undefined;
  return { id: row.id, email: row.email, name: row.name, role: 'admin', isActive: true };
}

export async function purgeExpiredTickets(): Promise<void> {
  await run('DELETE FROM websocket_tickets WHERE expires_at <= CURRENT_TIMESTAMP OR used_at IS NOT NULL');
}
