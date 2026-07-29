/**
 * text-parser.ts
 *
 * Lightweight, explicit text extractor function for resume file buffers.
 * Computes a SHA-256 textHash over extracted text for instant deduplication.
 */

import crypto from "crypto";

export interface ParsedDocumentText {
  rawText: string;
  textHash: string;
}

/**
 * Extracts raw text from an uploaded file buffer (Plain Text, UTF-8, PDF text fragment)
 * and calculates a deterministic SHA-256 hash.
 */
export async function parseDocumentText(
  buffer: Buffer,
  mimeType: string
): Promise<ParsedDocumentText> {
  let text = "";

  if (mimeType === "text/plain" || mimeType === "application/text" || mimeType === "text/markdown") {
    text = buffer.toString("utf-8");
  } else {
    // Basic text extraction for PDF/DOCX buffers (strips non-printable binary characters while keeping text)
    const raw = buffer.toString("utf-8");
    // If it looks like plain text or extracted UTF-8
    text = raw.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
  }

  // Fallback if empty
  if (!text || text.length < 10) {
    text = buffer.toString("latin1").replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
  }

  // Compute SHA-256 hash over normalized text
  const normalizedForHash = text.toLowerCase().replace(/\s+/g, "");
  const textHash = crypto.createHash("sha256").update(normalizedForHash).digest("hex");

  return {
    rawText: text,
    textHash
  };
}
