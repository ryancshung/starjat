import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload, Role } from '../lib/auth';
import { prisma } from '../lib/prisma';

export interface AuthRequest extends Request {
  user?: JwtPayload & { name?: string; points?: number };
}

export function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: '未提供認證令牌' });
    return;
  }

  try {
    const token = header.slice(7);
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: '無效或過期的令牌' });
  }
}

export function requireRoles(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: '未認證' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: '權限不足' });
      return;
    }
    next();
  };
}

export async function requireFamilyMember(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: '未認證' });
    return;
  }

  const membership = await prisma.familyMember.findFirst({
    where: { userId: req.user.userId },
    include: { family: true },
  });

  if (!membership) {
    res.status(403).json({ error: '您尚未加入任何家庭' });
    return;
  }

  (req as AuthRequest & { familyId: string }).familyId = membership.familyId;
  next();
}
