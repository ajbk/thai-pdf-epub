import JSZip from "jszip";
import { marked } from "marked";

export interface EpubChapter {
  title: string;
  /** Markdown ที่ได้จาก OCR (อาจมีตาราง HTML, <figure>, <page_number>) */
  markdown: string;
}

export interface EpubMeta {
  title: string;
  author: string;
  language: string; // เช่น "th"
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ทำให้ HTML จาก marked เป็น XHTML ที่ถูกต้องพอสำหรับ EPUB
function toXhtml(html: string): string {
  // ปิด void elements ให้เป็น self-closing
  const voids = ["br", "hr", "img", "input", "meta", "link", "col"];
  let out = html;
  for (const tag of voids) {
    // <br>  -> <br/>   และ <img ...>  -> <img .../>
    out = out.replace(
      new RegExp(`<${tag}([^>]*?)\\s*/?>`, "gi"),
      (_m, attrs) => `<${tag}${attrs} />`
    );
  }
  return out;
}

// แปลง tag เฉพาะของ Typhoon ให้แสดงผลสวยใน EPUB ก่อนส่งเข้า marked
function preprocessTyphoonTags(md: string): string {
  return md
    // เลขหน้า -> ข้อความจางๆ จัดกลาง
    .replace(
      /<page_number>([\s\S]*?)<\/page_number>/gi,
      (_m, n) => `\n\n<p class="page-number">— ${escapeXml(String(n).trim())} —</p>\n\n`
    )
    // figure -> blockquote บรรยายภาพ
    .replace(
      /<figure>([\s\S]*?)<\/figure>/gi,
      (_m, body) =>
        `\n\n<aside class="figure">${escapeXml(String(body).trim())}</aside>\n\n`
    );
}

function chapterXhtml(title: string, bodyHtml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="th" lang="th">
<head>
  <meta charset="UTF-8" />
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
<h1 class="chapter-title">${escapeXml(title)}</h1>
${bodyHtml}
</body>
</html>`;
}

const STYLE_CSS = `
body { font-family: "Sarabun", "TH Sarabun New", "Noto Sans Thai", sans-serif; line-height: 1.8; margin: 5%; }
h1.chapter-title { font-size: 1.4em; border-bottom: 2px solid #444; padding-bottom: 0.3em; }
p { text-indent: 0; margin: 0.6em 0; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid #888; padding: 6px 8px; text-align: left; }
th { background: #f0f0f0; }
aside.figure { background: #f7f7f7; border-left: 4px solid #999; padding: 0.6em 1em; margin: 1em 0; font-style: italic; color: #333; }
p.page-number { text-align: center; color: #999; font-size: 0.85em; margin: 1.2em 0; }
img { max-width: 100%; height: auto; }
`;

export async function buildEpub(
  meta: EpubMeta,
  chapters: EpubChapter[]
): Promise<Blob> {
  const zip = new JSZip();

  // mimetype ต้องเป็นไฟล์แรกและ "ไม่บีบอัด" ตามสเปก EPUB
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  zip.folder("META-INF")!.file(
    "container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`
  );

  const oebps = zip.folder("OEBPS")!;
  oebps.file("style.css", STYLE_CSS);

  const chapterFiles: { id: string; href: string; title: string }[] = [];
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const pre = preprocessTyphoonTags(ch.markdown || "");
    const rawHtml = await marked.parse(pre, { async: true });
    const bodyHtml = toXhtml(rawHtml);
    const fileName = `chapter${i + 1}.xhtml`;
    oebps.file(fileName, chapterXhtml(ch.title, bodyHtml));
    chapterFiles.push({ id: `chap${i + 1}`, href: fileName, title: ch.title });
  }

  const uid = `urn:uuid:${crypto.randomUUID()}`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  const manifestItems = chapterFiles
    .map(
      (c) =>
        `    <item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml" />`
    )
    .join("\n");
  const spineItems = chapterFiles
    .map((c) => `    <itemref idref="${c.id}" />`)
    .join("\n");

  oebps.file(
    "content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${meta.language}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${uid}</dc:identifier>
    <dc:title>${escapeXml(meta.title)}</dc:title>
    <dc:creator>${escapeXml(meta.author)}</dc:creator>
    <dc:language>${escapeXml(meta.language)}</dc:language>
    <meta property="dcterms:modified">${now}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    <item id="css" href="style.css" media-type="text/css" />
${manifestItems}
  </manifest>
  <spine toc="ncx">
${spineItems}
  </spine>
</package>`
  );

  // nav.xhtml (EPUB 3)
  const navList = chapterFiles
    .map((c) => `      <li><a href="${c.href}">${escapeXml(c.title)}</a></li>`)
    .join("\n");
  oebps.file(
    "nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${meta.language}" lang="${meta.language}">
<head><meta charset="UTF-8" /><title>สารบัญ</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>สารบัญ</h1>
    <ol>
${navList}
    </ol>
  </nav>
</body>
</html>`
  );

  // toc.ncx (เผื่อรองรับ EPUB 2 readers)
  const navPoints = chapterFiles
    .map(
      (c, i) =>
        `    <navPoint id="${c.id}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(c.title)}</text></navLabel>
      <content src="${c.href}" />
    </navPoint>`
    )
    .join("\n");
  oebps.file(
    "toc.ncx",
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${uid}" />
    <meta name="dtb:depth" content="1" />
    <meta name="dtb:totalPageCount" content="0" />
    <meta name="dtb:maxPageNumber" content="0" />
  </head>
  <docTitle><text>${escapeXml(meta.title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`
  );

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
  });
}
