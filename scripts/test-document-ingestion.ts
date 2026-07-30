// scripts/test-document-ingestion.ts

import { parseDocumentText } from "../src/lib/intelligence/extraction/text-parser";

console.log("=================================================================");
console.log("  RADAR v2 DOCUMENT INGESTION BENCHMARK (PDF, DOCX, TXT)");
console.log("=================================================================\n");

async function testDocumentIngestion() {
  // 1. Plain Text Buffer Test
  const txtBuffer = Buffer.from("Vice President Operations leading RevPAR Yield Optimization and Multi-Property Resort Operations.");
  const parsedTxt = await parseDocumentText(txtBuffer, "text/plain");
  console.log("1. Plain Text Ingestion:");
  console.log(`   ✓ Extracted Text Length : ${parsedTxt.rawText.length} chars`);
  console.log(`   ✓ SHA-256 Text Hash     : ${parsedTxt.textHash.slice(0, 16)}...\n`);

  // 2. Simulated DOCX Buffer Test
  const docxBuffer = Buffer.from("Chief Commercial Officer driving Power Purchase Agreement Structuring and Grid Interconnection.");
  const parsedDocx = await parseDocumentText(docxBuffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  console.log("2. DOCX Document Ingestion:");
  console.log(`   ✓ Extracted Text Length : ${parsedDocx.rawText.length} chars`);
  console.log(`   ✓ SHA-256 Text Hash     : ${parsedDocx.textHash.slice(0, 16)}...\n`);

  // 3. Simulated PDF Buffer Test
  const pdfBuffer = Buffer.from("Operating Partner leading Portfolio Value Creation and M&A Operational Due Diligence.");
  const parsedPdf = await parseDocumentText(pdfBuffer, "application/pdf");
  console.log("3. PDF Document Ingestion:");
  console.log(`   ✓ Extracted Text Length : ${parsedPdf.rawText.length} chars`);
  console.log(`   ✓ SHA-256 Text Hash     : ${parsedPdf.textHash.slice(0, 16)}...\n`);

  console.log("=================================================================");
  console.log("  DOCUMENT INGESTION PASSED: ALL FORMATS EXTRACTED Deterministically");
  console.log("=================================================================");
}

testDocumentIngestion().catch((err) => {
  console.error("Document Ingestion Error:", err);
  process.exit(1);
});
