export type CsvStudent={name:string;email:string;phone?:string;course?:string;activationDate?:string;expiryDate?:string};
/** Use ISO calendar dates in imports: local date strings, not JS Date.parse heuristics. */
export const isIsoCalendarDate=(date:string):boolean=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
  const parsed=new Date(`${date}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;
};
// RFC 4180-compatible quoted CSV parser, preserving embedded commas and newlines.
export function parseSubscriberCsv(text:string):{rows:CsvStudent[];errors:string[]} {
  const records:string[][]=[];let row:string[]=[],field='',quoted=false;
  const data=text.replace(/^\uFEFF/,'');
  for(let i=0;i<data.length;i++){
    const c=data[i]!;
    if(c==='"'){
      if(quoted&&data[i+1]==='"'){field+='"';i++;}
      else if(!quoted&&!field.trim())quoted=true;
      else if(quoted)quoted=false;
      else return {rows:[],errors:[`Invalid quote near character ${i+1}`]};
    }else if(c===','&&!quoted){row.push(field.trim());field='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&data[i+1]==='\n')i++;row.push(field.trim());field='';if(row.some(Boolean))records.push(row);row=[];}
    else field+=c;
  }
  if(quoted)return {rows:[],errors:['Unclosed quoted CSV field']};
  row.push(field.trim());if(row.some(Boolean))records.push(row);
  if(!records.length)return {rows:[],errors:['CSV is empty']};
  const headers=records.shift()!.map(x=>x.toLowerCase().replace(/\s+/g,''));
  const col=(name:string)=>headers.indexOf(name);
  for(const required of ['studentname','email','phonenumber','course']){
    if(!headers.includes(required))return {rows:[],errors:[`Missing header: ${required}. Required headers: Student name, Email, Phone number, Course`]};
  }
  const errors:string[]=[],seen=new Set<string>();
  if(records.length>200)errors.push('Import at most 200 students per CSV. Split larger files.');
  const rows=records.map((cells,index)=>{
    const name=cells[col('studentname')]?.trim()??'';
    const email=cells[col('email')]?.trim().toLowerCase()??'';
    const phone=cells[col('phonenumber')]?.trim()??'';
    const course=cells[col('course')]?.trim()??'';
    const activationDate=col('activationdate')<0?'':cells[col('activationdate')]?.trim()??'';
    const expiryDate=col('expirydate')<0?'':cells[col('expirydate')]?.trim()??'';
    if(name.length<2)errors.push(`Row ${index+2}: student name is required`);
    if(!/^\S+@\S+\.\S+$/.test(email))errors.push(`Row ${index+2}: invalid email`);
    if(!/^\+?[0-9 ()-]{7,20}$/.test(phone))errors.push(`Row ${index+2}: invalid phone number`);
    if(!course)errors.push(`Row ${index+2}: course is required`);
    if(activationDate&&!isIsoCalendarDate(activationDate))errors.push(`Row ${index+2}: Activation Date must be YYYY-MM-DD`);
    if(expiryDate&&!isIsoCalendarDate(expiryDate))errors.push(`Row ${index+2}: Expiry Date must be YYYY-MM-DD`);
    if(activationDate&&expiryDate&&isIsoCalendarDate(activationDate)&&isIsoCalendarDate(expiryDate)&&expiryDate<activationDate)errors.push(`Row ${index+2}: Expiry Date precedes Activation Date`);
    if(seen.has(email))errors.push(`Row ${index+2}: duplicate email`);
    seen.add(email);
    return {name,email,phone,course,...(activationDate?{activationDate}:{}),...(expiryDate?{expiryDate}:{})};
  });
  return {rows,errors};
}
