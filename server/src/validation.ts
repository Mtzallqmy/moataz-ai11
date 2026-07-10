import { z } from 'zod';
import { AppError } from './errors.js';

export function parseInput<T>(schema: z.ZodType<T>, input: unknown, code = 'invalid_request'): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError(code, 400, code, result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message
    })));
  }
  return result.data;
}

export const uuidSchema = z.string().uuid();
