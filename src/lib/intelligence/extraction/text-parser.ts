// src/lib/intelligence/extraction/text-parser.ts

import crypto from "crypto";
import mammoth from "mammoth";

export interface ParsedDocumentText {
  rawText: string;
  textHash: string;
}

/**
 * Robust, production-grade text extractor function supporting PDF, DOCX, TXT, and MD file buffers.
 * Computes a SHA-256 textHash over extracted text for instant deduplication.
 */
export async function parseDocumentText(
  buffer: Buffer,
  mimeType: string
): Promise<ParsedDocumentText> {
  let text = "";

  const isDocx =
    mimeType.includes("wordprocessingml") ||
    mimeType.includes("docx") ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  const isPdf = mimeType.includes("pdf") || mimeType === "application/pdf";

  if (isDocx) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || "";
    } catch (err) {
      console.warn("[text-parser] Mammoth DOCX parsing fallback triggered:", err);
      text = buffer.toString("utf-8");
    }
  } else if (isPdf) {
    try {
      // PDF text extraction buffer parser
      const raw = buffer.toString("utf-8");
      // Extract text content streams enclosed between BT (Begin Text) and ET (End Text) or readable UTF-8
      const matches = raw.match(/\(([^)]+)\)\s*Tj/g) || raw.match(/\[([^\]]+)\]\s*TJ/g);
      if (matches && matches.length > 0) {
        text = matches.map((m) => m.replace(/[\(\)\[\]]/g, "").trim()).join(" ");
      } else {
        text = raw.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
      }
    } catch (err) {
      console.warn("[text-parser] PDF extraction fallback triggered:", err);
      text = buffer.toString("latin1").replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
    }
  } else if (mimeType === "text/plain" || mimeType === "application/text" || mimeType === "text/markdown") {
    text = buffer.toString("utf-8");
  } else {
    // General fallback for unknown binary formats
    const raw = buffer.toString("utf-8");
    text = raw.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
  }

  // Fallback if empty or truncated
  if (!text || text.length < 10) {
    text = buffer.toString("latin1").replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
  }

  // Compute SHA-256 hash over normalized text for instant deduplication
  const normalizedForHash = text.toLowerCase().replace(/\s+/g, "");
  const textHash = crypto.createHash("sha256").update(normalizedForHash).digest("hex");

  return {
    rawText: text,
    textHash,
  };
}
