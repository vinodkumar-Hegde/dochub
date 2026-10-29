import type {UserRole} from '@prisma/client';
export type Principal={userId:string;roles:UserRole[];displayName?:string|null;moduleAuthorized?:boolean;canManageModule?:boolean};
export class AuthError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}
export function assertRole(principal: Principal, permitted: UserRole[]): void {
  if (principal.moduleAuthorized)return;
  if (!principal.roles.some((role) => permitted.includes(role))) {
    throw new AuthError(403, 'Insufficient permissions');
  }
}
