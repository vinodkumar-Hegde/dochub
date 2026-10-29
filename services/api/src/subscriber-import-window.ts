/** Per-row CSV dates override the shared form dates. Calendar dates are interpreted in IST. */
export const validImportDate=(value:string):boolean=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const parsed=new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
};
export function resolveImportWindow(
  row:{activationDate?:string;expiryDate?:string},
  defaultActiveFrom?:string,
  defaultValidUntil?:string|null,
):{activeFrom:Date;validUntil:Date|null}|null {
  if(row.activationDate!==undefined&&!validImportDate(row.activationDate))return null;
  if(row.expiryDate!==undefined&&!validImportDate(row.expiryDate))return null;
  const activeFrom=new Date(row.activationDate?`${row.activationDate}T00:00:00.000+05:30`:defaultActiveFrom??new Date().toISOString());
  const validUntil=row.expiryDate?new Date(`${row.expiryDate}T23:59:59.999+05:30`):defaultValidUntil?new Date(defaultValidUntil):null;
  if(Number.isNaN(activeFrom.getTime())||(validUntil&&Number.isNaN(validUntil.getTime())))return null;
  if(validUntil&&validUntil<=activeFrom)return null;
  return {activeFrom,validUntil};
}
