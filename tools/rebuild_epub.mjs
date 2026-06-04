// ประกอบ EPUB ใหม่จาก markdown เดิม + ฝัง "รูปจริง" เฉพาะหน้าที่มี <figure>
// ไม่ต้อง OCR ใหม่ — แค่ re-render หน้าที่มีรูปจาก PDF แล้วฝังลงไป
// ใช้งาน: node --experimental-strip-types tools/rebuild_epub.mjs "<pdf>" <outDir>
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildEpub } from "../lib/epub.ts";

const PDF_PATH = process.argv[2];
const OUT_DIR = process.argv[3] || "/home/ajbk/Downloads/sapiens_epub";
const PAGES_DIR = `${OUT_DIR}/pages`;
const IMAGE_DIM = parseInt(process.env.IMAGE_DIM || "1100", 10);
const PAGES_PER_CHAPTER = parseInt(process.env.PAGES_PER_CHAPTER || "20", 10);
const pad = (n) => String(n).padStart(4, "0");

async function renderPageJpeg(doc, n, dim) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const scale = dim / Math.max(base.width, base.height);
  const vp = page.getViewport({ scale });
  const canvas = createCanvas(Math.round(vp.width), Math.round(vp.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return canvas.toBuffer("image/jpeg");
}

async function main() {
  // หาเลขหน้าทั้งหมดจากไฟล์ pXXXX.md
  const pageNums = readdirSync(PAGES_DIR)
    .filter((f) => /^p\d+\.md$/.test(f))
    .map((f) => parseInt(f.slice(1, -3), 10))
    .sort((a, b) => a - b);
  if (!pageNums.length) throw new Error("ไม่พบไฟล์ pXXXX.md ใน " + PAGES_DIR);
  const first = pageNums[0], last = pageNums[pageNums.length - 1];
  console.log(`[rebuild] พบ ${pageNums.length} หน้า (${first}–${last})`);

  const data = new Uint8Array(await readFile(PDF_PATH));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;

  const assets = [];
  let figurePages = 0;

  // เตรียมเนื้อหารายหน้า (ฝังรูปถ้ามี figure)
  const pageContent = new Map();
  for (const n of pageNums) {
    let md = readFileSync(`${PAGES_DIR}/p${pad(n)}.md`, "utf8");
    if (md.includes("<figure>")) {
      figurePages++;
      const jpeg = await renderPageJpeg(doc, n, IMAGE_DIM);
      const fileName = `p${pad(n)}.jpg`;
      assets.push({ fileName, data: new Uint8Array(jpeg), mediaType: "image/jpeg" });
      // แทรกรูปจริงไว้ก่อน <figure> ตัวแรกของหน้า พร้อมคำบรรยายใต้ภาพ
      const imgBlock = `\n\n<img class="figure-image" src="images/${fileName}" alt="ภาพต้นฉบับหน้า ${n}" />\n<p class="figure-caption">ภาพจากต้นฉบับ หน้า ${n}</p>\n\n`;
      md = md.replace("<figure>", imgBlock + "<figure>");
      process.stdout.write(`\r  ฝังรูป: ${figurePages} หน้า (ล่าสุดหน้า ${n})   `);
    }
    pageContent.set(n, md);
  }
  console.log(`\n[rebuild] ฝังรูปจาก ${figurePages} หน้า, รวม ${assets.length} ไฟล์`);

  // จัดบทละ PAGES_PER_CHAPTER หน้า
  const chapters = [];
  for (let s = first; s <= last; s += PAGES_PER_CHAPTER) {
    const e = Math.min(s + PAGES_PER_CHAPTER - 1, last);
    let body = "";
    for (let n = s; n <= e; n++) if (pageContent.has(n)) body += pageContent.get(n) + "\n\n";
    if (body.trim()) chapters.push({ title: `หน้า ${s}–${e}`, markdown: body });
  }

  const meta = {
    title: process.env.BOOK_TITLE || "เซเปียนส์ ประวัติย่อมนุษยชาติ",
    author: process.env.BOOK_AUTHOR || "Yuval Noah Harari",
    language: "th",
  };
  const blob = await buildEpub(meta, chapters, assets);
  const buf = Buffer.from(await blob.arrayBuffer());
  const outPath = `${OUT_DIR}/book-with-images.epub`;
  await writeFile(outPath, buf);
  console.log(`[done] ${outPath} (${(buf.length / 1024 / 1024).toFixed(1)} MB, ${chapters.length} บท, ${assets.length} รูป)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
