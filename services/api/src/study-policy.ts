/** Student-owned PDF study markup. Points are normalized to a 1000×1000 page,
 * not server-controlled PDF pixels or arbitrary SVG/HTML. */
export type StudyPoint = [number, number];
export type StudyStroke = {id:string;color:string;width:number;kind:'pen'|'highlighter';points:StudyPoint[]};
// PostgreSQL INTEGER is the storage boundary; do not truncate large PDFs at 2,000 pages.
export const STUDY_MAX_PAGE = 2_147_483_647;
export const STUDY_MAX_STROKES = 250;
export const STUDY_MAX_POINTS = 4000;
const ALLOWED_COLORS = new Set(['#174fa4','#c43856','#187e69','#292d3b','#da9238']);
export function isStudyPageValid(page:number,count:number):boolean {
  return Number.isSafeInteger(page)&&Number.isSafeInteger(count)&&page>=1&&page<=count&&page<=STUDY_MAX_PAGE;
}
export function validateStudyStrokes(input:unknown):input is StudyStroke[] {
  if(!Array.isArray(input)||input.length>STUDY_MAX_STROKES)return false;
  let totalPoints=0;
  for(const entry of input){
    if(!entry||typeof entry!=='object'||Array.isArray(entry))return false;
    const s=entry as Record<string,unknown>;
    if(typeof s.id!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(s.id))return false;
    if(!ALLOWED_COLORS.has(s.color as string))return false;
    if(s.kind!=='pen'&&s.kind!=='highlighter')return false;
    if(typeof s.width!=='number'||!Number.isFinite(s.width)||s.width<1||s.width>24)return false;
    if(!Array.isArray(s.points)||s.points.length<1)return false;
    totalPoints+=s.points.length;
    if(totalPoints>STUDY_MAX_POINTS)return false;
    for(const point of s.points){
      if(!Array.isArray(point)||point.length!==2||point.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>1000))return false;
    }
  }
  return new Set(input.map(s=>(s as StudyStroke).id)).size===input.length;
}
export function readProgress(readPages:number,totalPages:number){
  return totalPages>0?Math.round(Math.max(0,Math.min(readPages,totalPages))*100/totalPages):0;
}
