export type PdfWatermark={position:string;color:string;opacity:number;rotation:number;fontSize:number};
export const defaultWatermark:PdfWatermark={position:'center',color:'#64748b',opacity:0.12,rotation:-20,fontSize:24};
type Watermark=PdfWatermark;
export async function visibleWatermarkedImage(source: Blob, studentEmail: string,watermark:Watermark=defaultWatermark): Promise<Blob> {
 if(!studentEmail.includes('@'))throw new Error('Verified student email required');
 const image=await createImageBitmap(source);
 try {
  const canvas=document.createElement('canvas');
  canvas.width=image.width;canvas.height=image.height;
  const context=canvas.getContext('2d');
  if(!context)throw new Error('Watermark composition unavailable');
  context.drawImage(image,0,0);
  context.save();
  const x=watermark.position.endsWith('left')?canvas.width*.24:watermark.position.endsWith('right')?canvas.width*.76:canvas.width/2;
  const y=watermark.position.startsWith('top')?canvas.height*.13:watermark.position.startsWith('bottom')?canvas.height*.87:canvas.height/2;
  context.translate(x,y);context.rotate(watermark.rotation*Math.PI/180);
  context.fillStyle=watermark.color;context.globalAlpha=watermark.opacity;context.textAlign='center';context.textBaseline='middle';
  const size=Math.max(12,Math.round(canvas.width*watermark.fontSize/612));
  context.font=`500 ${size}px sans-serif`;
  context.fillText(`DocTutorials · ${studentEmail}`,0,0,canvas.width*(watermark.position==='center'?.82:.45));
  context.restore();
  return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Watermark image encoding failed')),'image/jpeg',.88));
 } finally {image.close()}
}
