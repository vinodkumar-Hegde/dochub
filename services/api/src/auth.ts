import type { FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { PrismaClient, UserRole } from '@prisma/client';
import type { Config } from './config.js';

export type Principal = { userId: string; roles: UserRole[]; displayName?: string | null };
/** Cognito ID tokens must never authorize API access. Access tokens use client_id, not always aud. */
export function isCognitoAccessToken(payload: JWTPayload, clientId: string): boolean {
  return payload.token_use === 'access' && payload.client_id === clientId && typeof payload.sub === 'string';
}

export function createAuthenticator(config: Config, db: PrismaClient) {
  const jwks = createRemoteJWKSet(new URL(`${config.COGNITO_ISSUER}/.well-known/jwks.json`));
  return async (request: FastifyRequest): Promise<Principal> => {
    const bearer = request.headers.authorization;
    if (!bearer?.startsWith('Bearer ')) throw new AuthError(401, 'Authentication required');
    try {
      const { payload } = await jwtVerify(bearer.slice(7), jwks, {
        issuer: config.COGNITO_ISSUER,
      });
      if (!isCognitoAccessToken(payload, config.COGNITO_AUDIENCE)) throw new Error('Invalid token type or client');
      const user = await db.user.findUnique({
        where: { identitySub: payload.sub }, include: { roles: true },
      });
      if (!user?.enabled) throw new AuthError(403, 'Account is not authorized');
      const roles=user.roles.map(p=>p.role);
      // Student login is currently paused. When enabled, date-based access
      // is still enforced on every authenticated request, without a cron job.
      if(roles.includes('STUDENT')&&!roles.some(r=>['SUPER_ADMIN','CONTENT_MANAGER','FACULTY'].includes(r))){
        const now=new Date();
        const current=await db.enrollment.findFirst({where:{userId:user.id,activeFrom:{lte:now},OR:[{validUntil:null},{validUntil:{gt:now}}]},select:{userId:true}});
        if(!current)throw new AuthError(403,'Student subscription has not started or has expired');
      }
      return { userId: user.id, roles, displayName: user.displayName };
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(401, 'Invalid or expired access token');
    }
  };
}
export class AuthError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}
export function assertRole(principal: Principal, permitted: UserRole[]): void {
  if (!principal.roles.some((role) => permitted.includes(role))) {
    throw new AuthError(403, 'Insufficient permissions');
  }
}
