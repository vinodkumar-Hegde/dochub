/** Individual subscriber updates are complete replacement by default.
 * Retaining other programmes is an explicit opt-in for multi-programme students. */
export type StudentAccessMode = 'replace' | 'keep-other-programmes';
export function nextSubscriberGrants<T extends {programmeId:string}>(
  existing:readonly T[], changed:readonly T[], mode:StudentAccessMode, programmeId:string,
):T[]{
  if(mode==='replace')return [...changed];
  return [...existing.filter(grant=>grant.programmeId!==programmeId),...changed];
}
