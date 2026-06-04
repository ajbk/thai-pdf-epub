// แปลง PDF -> EPUB แบบ local headless: render หน้า (pdfjs + napi canvas) -> OCR (Ollama) -> EPUB
// ใช้งาน: node --experimental-strip-types tools/convert.mjs "<pdf>" <outDir> [startPage] [endPage]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildEpub } from "../lib/epub.ts";

const PDF_PATH = process.argv[2];
const OUT_DIR = process.argv[3] || "/tmp/epub_out";
const START = parseInt(process.argv[4] || "1", 10);
const END = process.argv[5] ? parseInt(process.argv[5], 10) : null;

const OLLAMA = process.env.OLLAMA_URL || "http://127.0.0.1:11434/v1";
const MODEL = process.env.OCR_MODEL || "scb10x/typhoon-ocr1.5-3b";
const TARGET_DIM = 1800;
const PAGES_PER_CHAPTER = parseInt(process.env.PAGES_PER_CHAPTER || "20", 10);

const PROMPT = `Extract all text from the image.


Instructions:
- Only return the clean Markdown.
- Do not include any explanation or extra text.
- You must include all information on the page.


Formatting Rules:
- Tables: Render tables using <table>...</table> in clean HTML format.
- Equations: Render equations using LaTeX syntax with inline ($...$) and block ($$...$$).
- Images/Charts/Diagrams: Wrap any clearly defined visual areas (e.g. charts, diagrams, pictures) in:


<figure>
Describe the image's main elements, visible text and meaning, then a concise summary. Describe in Thai.
</figure>


- Page Numbers: Wrap page numbers in <page_number>...</page_number> (e.g., <page_number>14</page_number>).
- Checkboxes: Use ☐ for unchecked and ☑ for checked boxes.
`;

const pad = (n) => String(n).padStart(4, "0");
const fmt = (s) => {
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return m ? `${m}m${sec}s` : `${sec}s`;
};

async function renderPage(doc, n) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const scale = TARGET_DIM / Math.max(base.width, base.height);
  const vp = page.getViewport({ scale });
  const canvas = createCanvas(Math.round(vp.width), Math.round(vp.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return canvas.toBuffer("image/jpeg");
}

async function ocr(jpegBuf) {
  const dataUrl = `data:image/jpeg;base64,${jpegBuf.toString("base64")}`;
  const resp = await fetch(`${OLLAMA}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: [
        { type: "text", text: PROMPT },
        { type: "image_url", image_url: { url: dataUrl } },
      ]}],
      max_tokens: 8192, temperature: 0.1, top_p: 0.6,
    }),
  });
  if (!resp.ok) throw new Error(`OCR ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function main() {
  await mkdir(`${OUT_DIR}/pages`, { recursive: true });
  const data = new Uint8Array(await readFile(PDF_PATH));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  const last = END || doc.numPages;
  const total = last - START + 1;
  console.log(`[convert] ${PDF_PATH}`);
  console.log(`[convert] หน้า ${START}–${last} (${total} หน้า) -> ${OUT_DIR}`);

  const t0 = Date.now();
  let done = 0;
  for (let n = START; n <= last; n++) {
    const mdFile = `${OUT_DIR}/pages/p${pad(n)}.md`;
    if (existsSync(mdFile) && readFileSync(mdFile, "utf8").trim().length > 0) {
      done++; continue; // resume: ข้ามหน้าที่ทำแล้ว
    }
    const pt = Date.now();
    try {
      const jpeg = await renderPage(doc, n);
      const md = await ocr(jpeg);
      await writeFile(mdFile, md, "utf8");
      done++;
      const each = (Date.now() - pt) / 1000;
      const elapsed = (Date.now() - t0) / 1000;
      const rate = elapsed / done;
      const eta = rate * (total - done);
      console.log(`[${done}/${total}] หน้า ${n}: ${md.length} ตัวอักษร, ${each.toFixed(1)}s | รวม ${fmt(elapsed)} | ETA ${fmt(eta)}`);
    } catch (e) {
      console.error(`[!] หน้า ${n} ล้มเหลว: ${e.message}`);
      await writeFile(mdFile + ".error", String(e), "utf8");
    }
  }

  // ประกอบ EPUB จากหน้าที่ OCR ได้ (กลุ่มละ PAGES_PER_CHAPTER หน้า)
  console.log(`[epub] กำลังประกอบ EPUB ...`);
  const chapters = [];
  for (let s = START; s <= last; s += PAGES_PER_CHAPTER) {
    const e = Math.min(s + PAGES_PER_CHAPTER - 1, last);
    let body = "";
    for (let n = s; n <= e; n++) {
      const f = `${OUT_DIR}/pages/p${pad(n)}.md`;
      if (existsSync(f)) body += readFileSync(f, "utf8") + "\n\n";
    }
    if (body.trim()) chapters.push({ title: `หน้า ${s}–${e}`, markdown: body });
  }
  const meta = {
    title: process.env.BOOK_TITLE || "เซเปียนส์ ประวัติย่อมนุษยชาติ",
    author: process.env.BOOK_AUTHOR || "Yuval Noah Harari",
    language: "th",
  };
  const blob = await buildEpub(meta, chapters);
  const buf = Buffer.from(await blob.arrayBuffer());
  const epubPath = `${OUT_DIR}/book.epub`;
  await writeFile(epubPath, buf);
  console.log(`[epub] เสร็จ: ${epubPath} (${(buf.length/1024/1024).toFixed(1)} MB, ${chapters.length} บท)`);
  console.log(`[done] รวมทั้งหมด ${fmt((Date.now()-t0)/1000)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
