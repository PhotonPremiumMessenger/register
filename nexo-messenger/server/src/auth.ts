import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from './config';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export interface AuthTokenPayload {
  sub: string; // user id
  email: string;
}

export function signToken(userId: string, email: string): string {
  return jwt.sign({ sub: userId, email }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string') return null;
    return { sub: payload.sub, email: String(payload.email || '') };
  } catch {
    return null;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  if (typeof req.query.token === 'string' && req.query.token) return req.query.token;
  return null;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) return next(new ApiError(401, 'Authentication required.'));
  const payload = verifyToken(token);
  if (!payload) return next(new ApiError(401, 'Session is invalid or expired. Please sign in again.'));
  req.userId = payload.sub;
  next();
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ── Validation helpers ────────────────────────────────────────────────

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function normalizeUsername(username: unknown): string {
  return String(username || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');
}

export function validateUsername(username: string): void {
  if (!USERNAME_RE.test(username)) {
    throw new ApiError(
      400,
      'Username must be 3–20 characters and may only contain lowercase letters, numbers and underscores.'
    );
  }
}

export function normalizeEmail(email: unknown): string {
  return String(email || '').trim().toLowerCase();
}

export function validateEmail(email: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, 'Please enter a valid email address.');
  }
}

export function validatePassword(password: unknown): string {
  const pw = String(password || '');
  if (pw.length < 8) throw new ApiError(400, 'Password must be at least 8 characters long.');
  if (pw.length > 200) throw new ApiError(400, 'Password is too long.');
  return pw;
}
