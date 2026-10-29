/** Independent from the programme mapping-approval lock. */
export type TaxonomyState = { hidden:boolean; accessLocked:boolean; archivedAt:Date|null };
export function isTaxonomyAvailable(item:TaxonomyState|null|undefined):boolean {
  return Boolean(item && !item.hidden && !item.accessLocked && !item.archivedAt);
}
export type SubscriptionWindow = { activeFrom:Date; validUntil:Date|null };
export function isSubscriptionActive(grant:SubscriptionWindow,now:Date):boolean {
  return grant.activeFrom<=now && (!grant.validUntil || grant.validUntil>now);
}
export function subscriberState(enabled:boolean, grants:ReadonlyArray<SubscriptionWindow>,now:Date):'LOCKED'|'ACTIVE'|'SCHEDULED'|'EXPIRED' {
  if(!enabled)return 'LOCKED';
  if(grants.some(g=>isSubscriptionActive(g,now)))return 'ACTIVE';
  if(grants.some(g=>g.activeFrom>now))return 'SCHEDULED';
  return 'EXPIRED';
}
export function validSubscriptionWindow(start:Date,end:Date|null):boolean {
  return !Number.isNaN(+start) && (!end || (!Number.isNaN(+end) && end>start));
}
