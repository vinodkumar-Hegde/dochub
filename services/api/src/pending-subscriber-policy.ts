/** Internal identity keys are not sign-in credentials. */
export function pendingIdentitySub(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Pending identity requires a UUID');
  }
  return `pending:${id.toLowerCase()}`;
}

type ExistingUser = { enabled: boolean; roles: ReadonlyArray<{role: string}> };
/** Existing employee accounts are never silently turned into student accounts
 * merely because an administrator typed an email address. */
export function existingSubscriberConflict(matches: readonly ExistingUser[]): string | null {
  if (matches.length > 1) return 'Multiple accounts use this email. Resolve duplicate identities before assigning subscriptions.';
  const candidate = matches[0];
  if (!candidate) return null;
  if (!candidate.enabled) return 'This student account is disabled';
  if (!candidate.roles.some(r => r.role === 'STUDENT')) {
    return 'This email belongs to an existing non-student account. Use a different student email.';
  }
  return null;
}
