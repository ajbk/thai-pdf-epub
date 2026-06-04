// Render หน้า PDF เป็นรูป JPEG data URL ฝั่ง browser (ไม่ต้องใช้ poppler บนเซิร์ฟเวอร์)

export interface RenderedPage {
  pageNumber: number;
  dataUrl: string;
}

// ย่อให้ด้านยาวสุด ~1800px เท่ากับค่า default ของ typhoon_ocr v1.5
const TARGET_LONGEST_DIM = 1800;
const JPEG_QUALITY = 0.85;

export async function loadPdf(file: File) {
  const pdfjs = await import("pdfjs-dist");
  // ตั้ง worker จาก CDN ให้ตรงเวอร์ชันที่ติดตั้ง
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  return doc;
}

export async function renderPageToDataUrl(
  doc: Awaited<ReturnType<typeof loadPdf>>,
  pageNumber: number
): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const longest = Math.max(baseViewport.width, baseViewport.height);
  const scale = TARGET_LONGEST_DIM / longest;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("ไม่สามารถสร้าง canvas context ได้");

  // พื้นหลังขาว (กัน PDF โปร่งใสกลายเป็นดำ)
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}
