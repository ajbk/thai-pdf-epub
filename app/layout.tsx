import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF → EPUB (ภาษาไทย) ด้วย Typhoon OCR",
  description:
    "แปลงไฟล์ PDF เป็น EPUB โดยใช้ Typhoon OCR สำหรับเอกสารภาษาไทย ทำงานบนเบราว์เซอร์ + Vercel",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
