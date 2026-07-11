import crypto from 'node:crypto';
import { config } from './config.js';
import { cryptoId, sha256 } from './database/ids.js';
import type { AuthUser } from './auth.js';
import { websocketTicketsRepository } from './repositories/websocket-tickets.repository.js';

export type TerminalTicketUser = AuthUser;

export async function issueTerminalTicket(userId: string): Promise<{ ticket: string; expiresAt: string }> {
  const ticket = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.wsTicketTtlSeconds * 1000).toISOString();
  await websocketTicketsRepository.create({
    id: cryptoId(),
    tokenHash: sha256(ticket),
    userId,
    purpose: 'terminal',
    expiresAt
  });
  return { ticket, expiresAt };
}

export async function consumeTerminalTicket(ticket: string): Promise<TerminalTicketUser | undefined> {
  const row = await websocketTicketsRepository.consume(sha256(ticket), 'terminal');
  if (!row || !row.is_active || row.role !== 'admin') return undefined;
  return { id: row.id, email: row.email, name: row.name, role: 'admin', isActive: true };
}

export async function purgeExpiredTickets(): Promise<void> {
  await websocketTicketsRepository.purge();
}
