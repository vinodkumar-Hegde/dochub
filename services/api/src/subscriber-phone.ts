/** Accept national and international formats without country-specific prefix rules.
 * Count digits rather than separators; retain the entered format for display.
 */
export function isSubscriberPhone(value:string):boolean {
  const phone=value.trim();
  if(!/^\+?[0-9\s()./\-]+$/.test(phone))return false;
  const digits=phone.replace(/\D/g,'');
  // International dialling prefixes and national trunk prefixes may be present.
  const number=digits.startsWith('00')?digits.slice(2):digits;
  return number.length>=6&&number.length<=17;
}
