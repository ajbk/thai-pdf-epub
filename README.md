# 📖 PDF → EPUB ภาษาไทย ด้วย Typhoon OCR

เว็บแอปแปลงไฟล์ **PDF เป็น EPUB** โดยเน้นเอกสารภาษาไทย ใช้ [Typhoon OCR](https://opentyphoon.ai/model/typhoon-ocr) (โมเดล vision-language ของ SCB 10X ที่เก่งเอกสารไทย) อ่านข้อความออกมาเป็น Markdown แล้วประกอบเป็น EPUB

สร้างด้วย **Next.js (App Router) + TypeScript** พร้อม deploy บน **Vercel**

## สถาปัตยกรรม

```
เบราว์เซอร์                         Vercel Serverless                Typhoon API
─────────────                      ─────────────────                ───────────
เลือก PDF
  │ render แต่ละหน้า → รูป (pdf.js)
  │ POST /api/ocr (data URL)  ───►  ส่งต่อ + แนบ API key  ───►  typhoon-ocr (v1.5)
  │                            ◄───  คืน Markdown          ◄───  Markdown
  │ รวม Markdown → XHTML → EPUB (JSZip)
  ▼ ดาวน์โหลด .epub
```

- **เรนเดอร์ PDF ฝั่งเบราว์เซอร์** ด้วย `pdfjs-dist` จึงไม่ต้องพึ่ง `poppler` บนเซิร์ฟเวอร์ (ติดตั้งบน Vercel serverless ยาก)
- **API key ถูกซ่อน** ไว้ฝั่งเซิร์ฟเวอร์ (`/api/ocr`) ไม่หลุดไปที่เบราว์เซอร์
- **สร้าง EPUB ฝั่งเบราว์เซอร์** ด้วย JSZip (mimetype + container.xml + content.opf + nav + ncx + chapters)
- คุม **rate limit** ~3.2 วินาที/หน้า (Typhoon free tier = 20 คำขอ/นาที) พร้อม retry เมื่อเจอ 429

## รันในเครื่อง

```bash
npm install
cp .env.local.example .env.local   # ใส่ TYPHOON_OCR_API_KEY ของจริง
npm run dev                        # เปิด http://localhost:3000
```

รับ API key ได้ที่ [playground.opentyphoon.ai](https://playground.opentyphoon.ai) (เมนู API Keys)

## Deploy บน Vercel

1. Push โค้ดขึ้น GitHub
2. ไปที่ [vercel.com](https://vercel.com) → **Add New… → Project** → Import repo นี้
3. ที่ **Environment Variables** เพิ่ม:
   - `TYPHOON_OCR_API_KEY` = API key ของคุณ
4. กด **Deploy**

> หมายเหตุ: ฟังก์ชัน `/api/ocr` ตั้ง `maxDuration = 60` วินาที — แพลน Hobby รองรับได้ ถ้าเอกสารหน้าใหญ่มากอาจต้องอัปเกรดแพลน

## เทคโนโลยีที่ใช้

| ส่วน | เครื่องมือ |
|------|-----------|
| เฟรมเวิร์ก | Next.js 15 (App Router) |
| OCR | Typhoon OCR v1.5 (`typhoon-ocr`) |
| เรนเดอร์ PDF | pdfjs-dist |
| Markdown → HTML | marked |
| สร้าง EPUB | JSZip |

## ข้อจำกัด / ไอเดียต่อยอด

- ตอนนี้ 1 หน้า PDF = 1 บท (chapter) ใน EPUB — ปรับเป็นรวมทั้งเล่มเป็นบทเดียวได้
- ยังไม่ฝังรูปภาพจริงลงใน EPUB (Typhoon บรรยายรูปเป็นข้อความใน `<figure>` แทน)
- เพิ่มหน้าปก, metadata, หรือ merge หลายไฟล์ได้
