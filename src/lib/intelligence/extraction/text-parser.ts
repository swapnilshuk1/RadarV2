import crypto from "crypto";

export interface ParsedDocumentText { rawText: string; textHash: string; }
export const MAX_EXTRACTED_DOCUMENT_TEXT_BYTES = 1_000_000;

function boundedText(value: string): string {
  const text = value.replace(/\u0000/g, "").trim();
  if (!text) throw new Error("DOCUMENT_TEXT_EMPTY");
  if (Buffer.byteLength(text, "utf8") > MAX_EXTRACTED_DOCUMENT_TEXT_BYTES) throw new Error("DOCUMENT_TEXT_TOO_LARGE");
  return text;
}

/** Parses only production-supported formats. Arbitrary binary is never treated as text. */
export async function parseDocumentText(buffer: Buffer, mimeType: string): Promise<ParsedDocumentText> {
  let text: string;
  if (mimeType === "application/pdf") {
    const { PDFParse } = await import(/* @vite-ignore */ "pdf-parse");
    const pdf = new PDFParse({ data: buffer });
    try { text = (await pdf.getText()).text; } finally { await pdf.destroy(); }
  } else if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const mammoth = await import(/* @vite-ignore */ "mammoth");
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (mimeType === "text/plain") {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } else {
    throw new Error("DOCUMENT_FORMAT_UNSUPPORTED");
  }
  const rawText = boundedText(text);
  return { rawText, textHash: crypto.createHash("sha256").update(rawText.toLowerCase().replace(/\s+/g, "")).digest("hex") };
}
