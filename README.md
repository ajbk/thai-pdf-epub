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

## รันแบบ Local (Ollama) — เร็วกว่า ไม่มี rate limit ⚡

ถ้ามี GPU (NVIDIA) สามารถรัน Typhoon OCR ในเครื่องผ่าน [Ollama](https://ollama.com) ได้ —
ความเร็วต่อหน้าพอ ๆ กับ cloud (~6 วินาที) แต่ **ยิงรัวได้ไม่ติด rate limit** และไม่มีค่าใช้จ่าย

ทดสอบแล้วบน **RTX 3060 12GB**: ~6 วินาที/หน้า (หลัง warm-up), ใช้ VRAM ~4.7GB

```bash
# 1) ติดตั้ง Ollama (ดู https://ollama.com/download)
# 2) ดึงโมเดล Typhoon OCR 1.5 (3B, Qwen3-VL)
ollama pull scb10x/typhoon-ocr1.5-3b

# 3) ใน .env.local ชี้แอปมาที่ Ollama
#    TYPHOON_OCR_API_KEY=ollama          (อะไรก็ได้ ห้ามว่าง)
#    TYPHOON_BASE_URL=http://127.0.0.1:11434/v1
#    TYPHOON_OCR_MODEL=scb10x/typhoon-ocr1.5-3b
#    NEXT_PUBLIC_OCR_MIN_INTERVAL_MS=300

# 4) เริ่มทั้งระบบด้วยสคริปต์ช่วย (ตั้งค่า Ollama + pre-warm + เปิดเว็บ)
./start-local.sh
```

แนะนำตั้งค่า Ollama เหล่านี้ (สคริปต์ `start-local.sh` ตั้งให้แล้ว):
- `OLLAMA_CONTEXT_LENGTH=16384` — รองรับรูปหน้าใหญ่ + ข้อความยาว (ค่า default 4096 น้อยไป)
- `OLLAMA_FLASH_ATTENTION=1` — ประหยัด VRAM
- `OLLAMA_KEEP_ALIVE=-1` — คงโมเดลใน VRAM ไม่ต้องโหลดซ้ำ (หน้าแรกของ session โหลดครั้งเดียว)

> สลับกลับไป cloud ได้ทุกเมื่อ แค่คอมเมนต์ `TYPHOON_BASE_URL` ออกแล้วใส่ cloud API key

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
