/** Streaming, personalized PDF assembled from validated private page previews.
 * No original PDF bytes or pre-signed S3 URLs leave the authorized student API.
 * Each page's watermark is a PDF drawing operation, not a browser overlay.
 */
export type PrivatePageImage = (page: number) => Promise<Uint8Array>;

export function embeddedJpegInfo(jpg: Uint8Array): { width: number; height: number; colorSpace: string } {
  if (jpg.length < 64 || jpg[0] !== 0xff || jpg[1] !== 0xd8 || jpg[jpg.length-2] !== 0xff || jpg[jpg.length-1] !== 0xd9) {
    throw new Error('Invalid private JPEG page');
  }
  let pos = 2;
  while (pos < jpg.length - 2) {
    if (jpg[pos] !== 0xff) throw new Error('Invalid JPEG marker');
    while (jpg[pos] === 0xff) pos++;
    const marker = jpg[pos++];
    if (marker === undefined) throw new Error('Invalid JPEG marker');
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (pos + 2 > jpg.length) break;
    const length = (jpg[pos]! << 8) | jpg[pos+1]!;
    if (length < 2 || pos + length > jpg.length) throw new Error('Invalid JPEG segment');
    if ([0xc0,0xc1,0xc2].includes(marker)) {
      if (length < 8) throw new Error('Invalid JPEG dimensions');
      const height = (jpg[pos+3]! << 8) | jpg[pos+4]!;
      const width = (jpg[pos+5]! << 8) | jpg[pos+6]!;
      const components = jpg[pos+7];
      if (!width || !height || width > 20000 || height > 20000 || ![1,3].includes(components!)) {
        throw new Error('Unsupported private JPEG page');
      }
      return { width, height, colorSpace: components === 1 ? '/DeviceGray' : '/DeviceRGB' };
    }
    pos += length;
  }
  throw new Error('JPEG dimensions not found');
}

export function safeStudentWatermark(email: string): string {
  const value = email.trim();
  if (value.length > 254 || !/^[\x21-\x7e]+$/.test(value) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    throw new Error('Valid student email required for a personalized PDF');
  }
  return `DocTutorials - ${value}`;
}
const pdfLiteral = (s: string) => s.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
const decimal = (value: number) => Number(value.toFixed(3)).toString();

/** Bounded buffer usage: at most one image is in application memory at a time.
 * The caller is responsible for authenticated access, S3 reads and auditing.
 */
export async function* streamStudentWatermarkedPdf(
  pageCount: number,
  email: string,
  loadPage: PrivatePageImage,
): AsyncGenerator<Buffer> {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > (Number.MAX_SAFE_INTEGER-5)/3) {
    throw new Error('Invalid verified PDF page count');
  }
  const mark = pdfLiteral(safeStudentWatermark(email));
  const totalObjects = 4 + 3*pageCount;
  const offsets = new Array<number>(totalObjects+1).fill(0);
  let position = 0;
  const emit = (content: string | Uint8Array): Buffer => {
    const chunk = typeof content === 'string' ? Buffer.from(content, 'ascii') : Buffer.from(content);
    position += chunk.byteLength;
    return chunk;
  };
  const object = (id: number, contents: string): Buffer => {
    offsets[id] = position;
    return emit(`${id} 0 obj\n${contents}\nendobj\n`);
  };
  yield emit('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  yield object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const kids = Array.from({length:pageCount},(_,i)=>`${7+i*3} 0 R`).join(' ');
  yield object(2, `<< /Type /Pages /Kids [ ${kids} ] /Count ${pageCount} >>`);
  yield object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  yield object(4, '<< /Type /ExtGState /CA 0.38 /ca 0.38 >>');

  for (let n=1;n<=pageCount;n++) {
    const imageObject = 5+(n-1)*3;
    const contentsObject = imageObject+1;
    const pageObject = imageObject+2;
    const bytes = await loadPage(n);
    if (bytes.byteLength > 24*1024*1024) throw new Error('Private preview page exceeds safety limit');
    const {width,height,colorSpace} = embeddedJpegInfo(bytes);
    const pageWidth = width > height ? 792 : 612;
    const pageHeight = width > height ? 612 : 792;
    const scale = Math.min(pageWidth/width,pageHeight/height);
    const drawnWidth = width * scale, drawnHeight = height * scale;
    const x = (pageWidth-drawnWidth)/2, y = (pageHeight-drawnHeight)/2;
    offsets[imageObject] = position;
    yield emit(`${imageObject} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.byteLength} >>\nstream\n`);
    yield emit(bytes);
    yield emit('\nendstream\nendobj\n');
    // Light repeated marks across the page plus a visible footer. PDF output
    // itself contains the email; viewer CSS and browser print settings cannot remove it.
    const fontSize = Math.max(11,Math.min(27, 390 / Math.max(10,mark.length)*1.8));
    const watermark = [0.25,0.52,0.78].map(fraction=>
      `q /GSwm gs BT /Fwm ${decimal(fontSize)} Tf 0.38 0.42 0.54 rg 0.9063 0.4226 -0.4226 0.9063 28 ${decimal(pageHeight*fraction)} Tm (${mark}) Tj ET Q`
    ).join('\n');
    const content = `q ${decimal(drawnWidth)} 0 0 ${decimal(drawnHeight)} ${decimal(x)} ${decimal(y)} cm /Im0 Do Q\n${watermark}\nBT /Fwm 9 Tf 0.25 0.32 0.45 rg 1 0 0 1 22 17 Tm (${mark}) Tj ET\n`;
    const contentBytes = Buffer.from(content, 'ascii');
    offsets[contentsObject] = position;
    yield emit(`${contentsObject} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
    yield emit(contentBytes);
    yield emit('endstream\nendobj\n');
    yield object(pageObject,`<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${pageWidth} ${pageHeight} ] /Resources << /XObject << /Im0 ${imageObject} 0 R >> /Font << /Fwm 3 0 R >> /ExtGState << /GSwm 4 0 R >> >> /Contents ${contentsObject} 0 R >>`);
  }
  const xrefPosition = position;
  yield emit(`xref\n0 ${totalObjects+1}\n0000000000 65535 f \n`);
  for(let id=1;id<=totalObjects;id++){
    const offset = offsets[id];
    if (offset === undefined || offset >= 10_000_000_000) throw new Error('PDF export exceeds supported output size');
    yield emit(`${String(offset).padStart(10,'0')} 00000 n \n`);
  }
  yield emit(`trailer\n<< /Size ${totalObjects+1} /Root 1 0 R >>\nstartxref\n${xrefPosition}\n%%EOF\n`);
}
