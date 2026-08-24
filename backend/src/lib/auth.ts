import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export type Role = 'ADMIN' | 'PARENT' | 'CHILD';

const defaultJwtSecret = process.env.JWT_SECRET || 'dev-secret';
const defaultJwtExpiresIn = process.env.JWT_EXPIRES_IN || '7d';

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(
  payload: JwtPayload,
  secret = defaultJwtSecret,
  expiresIn = defaultJwtExpiresIn
): string {
  return jwt.sign(payload, secret, {
    expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string, secret = defaultJwtSecret): JwtPayload {
  return jwt.verify(token, secret) as JwtPayload;
}

export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
