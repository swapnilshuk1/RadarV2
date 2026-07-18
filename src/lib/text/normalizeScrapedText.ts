/**
 * normalizeScrapedText.ts
 * 
 * Centralized utility to convert raw scraped HTML description blocks 
 * into clean, formatted, newline-preserved plaintext.
 * Prevents sentence boundary collapse by preserving newlines on blocks/list tags.
 */
export function normalizeScrapedText(html: string): string {
  if (!html) return "";

  // 1. Convert line breaks and list blocks to clean newlines
  let txt = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li>/gi, "\n• ")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " | ")
    .replace(/<\/th>/gi, " | \n");

  // 2. Remove all remaining HTML tags
  txt = txt.replace(/<[^>]*>/g, "");

  // 3. Decode common HTML entities
  txt = txt
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // 4. Normalize lists and bullet lines (ensure • or numbers start on their own line)
  txt = txt
    .replace(/[•●▪]/g, "\n• ")
    .replace(/\b(\d+)\.\s+/g, "\n$1. ");

  // 5. Clean line-by-line whitespace and rebuild
  const lines = txt
    .split("\n")
    .map(line => {
      // Replace consecutive spaces with a single space
      let cleaned = line.replace(/\s+/g, " ").trim();
      return cleaned;
    })
    .filter(Boolean);

  return lines.join("\n");
}
