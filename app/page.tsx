"use client";

import { useCallback, useRef, useState } from "react";
import { loadPdf, renderPageToDataUrl } from "@/lib/pdf";
import { buildEpub, type EpubChapter } from "@/lib/epub";

type Status = "pending" | "running" | "done" | "error";

interface PageState {
  pageNumber: number;
  status: Status;
  markdown: string;
  error?: string;
}

// Typhoon free tier: ~20 req/min => เว้นช่วง ~3.2s/หน้า กัน 429
const MIN_INTERVAL_MS = 3200;
const MAX_RETRY = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("Typhoon OCR");
  const [figureLanguage, setFigureLanguage] = useState<"Thai" | "English">("Thai");
  const [pages, setPages] = useState<PageState[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "ocr" | "epub" | "done">("idle");
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const cancelRef = useRef(false);

  const doneCount = pages.filter((p) => p.status === "done").length;
  const progress = pages.length ? Math.round((doneCount / pages.length) * 100) : 0;

  const onPickFile = useCallback(async (f: File) => {
    setGlobalError(null);
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      setGlobalError("กรุณาเลือกไฟล์ PDF");
      return;
    }
    setFile(f);
    setPhase("idle");
    if (!title) setTitle(f.name.replace(/\.pdf$/i, ""));
    try {
      const doc = await loadPdf(f);
      const n = doc.numPages;
      setPages(
        Array.from({ length: n }, (_, i) => ({
          pageNumber: i + 1,
          status: "pending" as Status,
          markdown: "",
        }))
      );
    } catch (e) {
      setGlobalError("เปิดไฟล์ PDF ไม่สำเร็จ: " + String(e));
      setPages([]);
    }
  }, [title]);

  async function ocrPage(dataUrl: string): Promise<string> {
    let lastErr = "";
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      const resp = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: dataUrl, figureLanguage }),
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.markdown ?? "";
      }
      lastErr = `${resp.status}`;
      try {
        const j = await resp.json();
        lastErr = j.error || lastErr;
      } catch {}
      // 429 = โดน rate limit -> backoff แล้วลองใหม่
      if (resp.status === 429 && attempt < MAX_RETRY) {
        await sleep(MIN_INTERVAL_MS * (attempt + 2));
        continue;
      }
      break;
    }
    throw new Error(lastErr);
  }

  async function startConversion() {
    if (!file || !pages.length) return;
    setBusy(true);
    setPhase("ocr");
    setGlobalError(null);
    cancelRef.current = false;

    try {
      const doc = await loadPdf(file);
      let lastStart = 0;
      for (let i = 0; i < pages.length; i++) {
        if (cancelRef.current) break;
        const pageNum = i + 1;
        setPages((prev) =>
          prev.map((p) => (p.pageNumber === pageNum ? { ...p, status: "running" } : p))
        );

        // เว้นช่วงให้พอดี rate limit
        const wait = MIN_INTERVAL_MS - (Date.now() - lastStart);
        if (wait > 0 && i > 0) await sleep(wait);
        lastStart = Date.now();

        try {
          const dataUrl = await renderPageToDataUrl(doc, pageNum);
          const md = await ocrPage(dataUrl);
          setPages((prev) =>
            prev.map((p) =>
              p.pageNumber === pageNum ? { ...p, status: "done", markdown: md } : p
            )
          );
        } catch (e) {
          setPages((prev) =>
            prev.map((p) =>
              p.pageNumber === pageNum
                ? { ...p, status: "error", error: String(e) }
                : p
            )
          );
        }
      }
      setPhase("done");
    } catch (e) {
      setGlobalError("เกิดข้อผิดพลาดระหว่างแปลง: " + String(e));
    } finally {
      setBusy(false);
    }
  }

  async function downloadEpub() {
    const usable = pages.filter((p) => p.markdown.trim().length > 0);
    if (!usable.length) {
      setGlobalError("ยังไม่มีข้อความจากหน้าใดเลย");
      return;
    }
    setPhase("epub");
    setBusy(true);
    try {
      const chapters: EpubChapter[] = usable.map((p) => ({
        title: `หน้า ${p.pageNumber}`,
        markdown: p.markdown,
      }));
      const blob = await buildEpub(
        { title: title || "เอกสาร", author: author || "ไม่ระบุ", language: "th" },
        chapters
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (title || "document").replace(/[^\w฀-๿.-]+/g, "_") + ".epub";
      a.click();
      URL.revokeObjectURL(url);
      setPhase("done");
    } catch (e) {
      setGlobalError("สร้าง EPUB ไม่สำเร็จ: " + String(e));
    } finally {
      setBusy(false);
    }
  }

  function updateMarkdown(pageNumber: number, md: string) {
    setPages((prev) =>
      prev.map((p) => (p.pageNumber === pageNumber ? { ...p, markdown: md } : p))
    );
  }

  return (
    <div className="container">
      <header>
        <h1>📖 PDF → EPUB ภาษาไทย</h1>
        <p>แปลงเอกสาร PDF เป็น EPUB ด้วย Typhoon OCR — เรนเดอร์หน้าในเบราว์เซอร์ แล้ว OCR ผ่านเซิร์ฟเวอร์</p>
      </header>

      <div className="card">
        <div
          className={"dropzone" + (dragging ? " drag" : "")}
          onClick={() => document.getElementById("file-input")?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onPickFile(f);
          }}
        >
          {file ? (
            <span><strong>{file.name}</strong> — {pages.length} หน้า (คลิกเพื่อเปลี่ยนไฟล์)</span>
          ) : (
            <span>ลากไฟล์ PDF มาวาง หรือ <strong>คลิกเพื่อเลือก</strong></span>
          )}
          <input
            id="file-input"
            type="file"
            accept="application/pdf,.pdf"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); }}
          />
        </div>
      </div>

      {file && (
        <div className="card">
          <div className="row">
            <label className="field" style={{ flex: 1, minWidth: 220 }}>
              ชื่อหนังสือ
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 180 }}>
              ผู้แต่ง
              <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} />
            </label>
            <label className="field">
              คำบรรยายรูปภาพ
              <select
                value={figureLanguage}
                onChange={(e) => setFigureLanguage(e.target.value as "Thai" | "English")}
              >
                <option value="Thai">ภาษาไทย</option>
                <option value="English">English</option>
              </select>
            </label>
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <button onClick={startConversion} disabled={busy || !pages.length}>
              {phase === "ocr" && busy ? "กำลัง OCR..." : "▶ เริ่มแปลง (OCR)"}
            </button>
            {busy && phase === "ocr" && (
              <button className="secondary" onClick={() => (cancelRef.current = true)}>หยุด</button>
            )}
            <button
              className="success"
              onClick={downloadEpub}
              disabled={busy || doneCount === 0}
            >
              ⬇ ดาวน์โหลด EPUB ({doneCount} หน้า)
            </button>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            เว้นช่วง ~3.2 วินาที/หน้า เพื่อไม่ให้เกิน rate limit ของ Typhoon (20 คำขอ/นาที)
          </p>
        </div>
      )}

      {pages.length > 0 && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>ความคืบหน้า: {doneCount}/{pages.length} หน้า</strong>
            <span className="muted">{progress}%</span>
          </div>
          <div className="progress"><div style={{ width: `${progress}%` }} /></div>

          {pages.map((p) => (
            <details key={p.pageNumber} className="page-item" open={p.status === "error"}>
              <summary>
                <span className={`status-dot status-${p.status}`} />
                หน้า {p.pageNumber}
                <span className="muted" style={{ marginLeft: "auto" }}>
                  {p.status === "pending" && "รอคิว"}
                  {p.status === "running" && "กำลังอ่าน..."}
                  {p.status === "done" && `${p.markdown.length} ตัวอักษร`}
                  {p.status === "error" && "ผิดพลาด"}
                </span>
              </summary>
              {p.status === "error" ? (
                <div className="error-box" style={{ margin: 12 }}>{p.error}</div>
              ) : (
                <textarea
                  value={p.markdown}
                  placeholder="ผลลัพธ์ Markdown จะปรากฏที่นี่ (แก้ไขได้ก่อนสร้าง EPUB)"
                  onChange={(e) => updateMarkdown(p.pageNumber, e.target.value)}
                />
              )}
            </details>
          ))}
        </div>
      )}

      {globalError && <div className="error-box">{globalError}</div>}

      {!file && (
        <div className="hint">
          <strong>วิธีใช้:</strong> เลือกไฟล์ PDF → กด “เริ่มแปลง” ระบบจะเรนเดอร์ทีละหน้าแล้วส่งให้ Typhoon OCR
          อ่านเป็นข้อความ Markdown → ตรวจ/แก้ได้ → กด “ดาวน์โหลด EPUB”.
          <br />
          ต้องตั้งค่า <code>TYPHOON_OCR_API_KEY</code> ใน environment ก่อนใช้งาน
          (ดู <code>.env.local.example</code>)
        </div>
      )}
    </div>
  );
}
