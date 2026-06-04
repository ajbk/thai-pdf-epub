import { NextRequest, NextResponse } from "next/server";

// รันบน Node.js runtime (ไม่ใช่ edge) เผื่อ payload รูปใหญ่ และให้ timeout ยาวขึ้น
export const runtime = "nodejs";
export const maxDuration = 60; // วินาที (Vercel: ปรับได้ตามแพลน)

const BASE_URL = process.env.TYPHOON_BASE_URL || "https://api.opentyphoon.ai/v1";
const MODEL = process.env.TYPHOON_OCR_MODEL || "typhoon-ocr";

// Prompt v1.5 จากแพ็กเกจ typhoon_ocr อย่างเป็นทางการ (figure อธิบายเป็นภาษาไทย)
function buildPrompt(figureLanguage: string): string {
  return `Extract all text from the image.


Instructions:
- Only return the clean Markdown.
- Do not include any explanation or extra text.
- You must include all information on the page.


Formatting Rules:
- Tables: Render tables using <table>...</table> in clean HTML format.
- Equations: Render equations using LaTeX syntax with inline ($...$) and block ($$...$$).
- Images/Charts/Diagrams: Wrap any clearly defined visual areas (e.g. charts, diagrams, pictures) in:


<figure>
Describe the image's main elements (people, objects, text), note any contextual clues (place, event, culture), mention visible text and its meaning, provide deeper analysis when relevant (especially for financial charts, graphs, or documents), comment on style or architecture if relevant, then give a concise overall summary. Describe in ${figureLanguage}.
</figure>


- Page Numbers: Wrap page numbers in <page_number>...</page_number> (e.g., <page_number>14</page_number>).
- Checkboxes: Use ☐ for unchecked and ☑ for checked boxes.
    `;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.TYPHOON_OCR_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ยังไม่ได้ตั้งค่า TYPHOON_OCR_API_KEY บนเซิร์ฟเวอร์" },
      { status: 500 }
    );
  }

  let body: { imageDataUrl?: string; figureLanguage?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const { imageDataUrl, figureLanguage = "Thai" } = body;
  if (!imageDataUrl || !imageDataUrl.startsWith("data:image/")) {
    return NextResponse.json(
      { error: "ต้องส่งรูปภาพหน้าเอกสารมาเป็น data URL" },
      { status: 400 }
    );
  }

  const prompt = buildPrompt(figureLanguage === "English" ? "English" : "Thai");

  try {
    const resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
        max_tokens: 16384,
        temperature: 0.1,
        top_p: 0.6,
        repetition_penalty: 1.1,
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return NextResponse.json(
        { error: `Typhoon API ตอบกลับผิดพลาด (${resp.status})`, detail },
        { status: 502 }
      );
    }

    const data = await resp.json();
    const markdown: string = data?.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({ markdown });
  } catch (err) {
    return NextResponse.json(
      { error: "เรียก Typhoon API ไม่สำเร็จ", detail: String(err) },
      { status: 502 }
    );
  }
}
