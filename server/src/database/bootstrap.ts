import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { cryptoId } from './ids.js';
import { usersRepository } from '../repositories/users.repository.js';

export async function ensureDefaultAdmin(): Promise<void> {
  const existing = await usersRepository.findByEmail(config.defaultAdminEmail);
  if (existing) return;
  const passwordHash = await bcrypt.hash(config.defaultAdminPassword, 12);
  await usersRepository.create({
    id: cryptoId(),
    email: config.defaultAdminEmail,
    passwordHash,
    name: 'Administrator',
    role: 'admin',
    isActive: true
  });
  logger.info('default_admin_created', { email: config.defaultAdminEmail });
}
