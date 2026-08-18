/**
 * Raw JD Analysis: Check if reporting line info exists but isn't being extracted
 */

import { readFileSync } from "fs";
import { join } from "path";

const JD_PATH = "./src/data/live-scraped.json";

interface ScrapedJob {
  jobHash: string;
  rawText?: string;
  description?: string;
  normalizedText?: string;
  title?: string;
  company?: string;
  dimensions?: any[];
}

// Patterns that indicate reporting line information
const reportingLinePatterns = [
  // Direct reporting patterns
  /report(s|ing)\s+(to|into)/i,
  /report(s|ing)?\s+(?:directly)?\s*to\s+(?:the\s+)?(?:CEO|CFO|CMO|CTO|CIO|COO|Chief|President|VP|Vice President|Director|Head|Founder|MD|Managing Director)/i,
  /(?:CEO|CFO|CMO|CTO|CIO|COO|Chief|President|VP|Vice President|Director|Head|Founder)\s+report(s|ing)?/i,
  /dotted\s+line\s+(?:to|report)/i,
  /solid\s+line\s+(?:to|report)/i,
  /matrix\s+report(s|ing)/i,
  /functional\s+report(s|ing)/i,
  /administrative\s+report(s|ing)/i,
  /dual\s+report(s|ing)/i,
  /reporting\s+relationship/i,
  /reporting\s+structure/i,
  /reporting\s+hierarchy/i,
  /reporting\s+lines/i,
  /reports\s+to/i,
  /report\s+to/i,
  /reporting\s+to/i,
  /work(s|ing)?\s+(?:closely\s+)?with\s+(?:the\s+)?(?:CEO|CFO|CMO|CTO|CIO|COO)/i,
  /closely\s+with\s+(?:the\s+)?(?:founder|CEO|leadership)/i,
  /interface\s+with\s+(?:the\s+)?(?:board|CEO|leadership)/i,
  /present\s+to\s+(?:the\s+)?(?:board|CEO|leadership)/i,
  /escalat(e|ion)\s+to\s+(?:the\s+)?(?:CEO|leadership)/i,
  /partner\s+with\s+(?:the\s+)?(?:CEO|founder)/i,
  /collaborate\s+with\s+(?:the\s+)?(?:CEO|founder)/i,
];

// Extract reporting line context (50 chars before and after match)
function extractContext(text: string, match: RegExpMatchArray): string {
  const start = Math.max(0, match.index! - 50);
  const end = Math.min(text.length, match.index! + match[0].length + 50);
  return text.substring(start, end).replace(/\s+/g, " ").trim();
}

function analyzeJobs() {
  console.log("=== Raw JD Analysis: Reporting Line Extraction ===\n");
  
  const raw = readFileSync(JD_PATH, "utf-8");
  const jobs: ScrapedJob[] = JSON.parse(raw);
  
  console.log(`Total jobs analyzed: ${jobs.length}\n`);
  
  let hasReportingLineInRawText = 0;
  let hasReportingLineInDescription = 0;
  let extractedSuccessfully = 0;
  let extractedMissing = 0;
  
  const samplesWithReportingLine: { jobHash: string; company: string; title: string; context: string; extractedBucket: string; extractedValue: any }[] = [];
  
  for (let i = 0; i < Math.min(150, jobs.length); i++) {
    const job = jobs[i];
    const textToSearch = (job.rawText || job.description || job.normalizedText || "").toLowerCase();
    
    // Check if reporting line info exists in raw text
    let foundInRawText = false;
    let context = "";
    
    for (const pattern of reportingLinePatterns) {
      const match = textToSearch.match(pattern);
      if (match) {
        foundInRawText = true;
        context = extractContext(textToSearch, match);
        break;
      }
    }
    
    // Check extraction status
    const reportingDim = job.dimensions?.find((d: any) => d.key === "reportingLine");
    const extractedBucket = reportingDim?.bucket || "N/A";
    const extractedValue = reportingDim?.jdEvidence?.value;
    const extractedStatus = reportingDim?.jdEvidence?.status;
    
    if (foundInRawText) {
      hasReportingLineInRawText++;
      
      if (extractedBucket === "Matched" || extractedBucket === "Adjacent") {
        extractedSuccessfully++;
      } else {
        extractedMissing++;
        samplesWithReportingLine.push({
          jobHash: job.jobHash,
          company: job.company || "Unknown",
          title: job.title || "Unknown",
          context,
          extractedBucket,
          extractedValue,
        });
      }
    }
  }
  
  console.log(`Analysis of first 150 jobs:\n`);
  console.log(`Jobs with reporting line info in raw text: ${hasReportingLineInRawText} (${((hasReportingLineInRawText/150)*100).toFixed(1)}%)`);
  console.log(`  - Successfully extracted: ${extractedSuccessfully}`);
  console.log(`  - Failed to extract: ${extractedMissing}`);
  console.log(`  - Extraction success rate: ${((extractedSuccessfully/Math.max(1, hasReportingLineInRawText))*100).toFixed(1)}%\n`);
  
  console.log("=== Sample Cases: Reporting Line Found but Not Extracted ===\n");
  
  // Show first 15 examples
  const samplesToShow = samplesWithReportingLine.slice(0, 15);
  for (const sample of samplesToShow) {
    console.log(`Job: ${sample.jobHash}`);
    console.log(`Company: ${sample.company}`);
    console.log(`Title: ${sample.title}`);
    console.log(`Extracted Bucket: ${sample.extractedBucket}`);
    console.log(`Extracted Value: ${sample.extractedValue}`);
    console.log(`Context from JD: "...${sample.context}..."`);
    console.log("---\n");
  }
  
  // Pattern analysis
  console.log("=== Pattern Analysis ===\n");
  
  const patternsFound: Record<string, number> = {};
  
  for (let i = 0; i < Math.min(150, jobs.length); i++) {
    const job = jobs[i];
    const textToSearch = (job.rawText || job.description || job.normalizedText || "").toLowerCase();
    
    for (const pattern of reportingLinePatterns) {
      if (pattern.test(textToSearch)) {
        const patternName = pattern.toString().substring(0, 60) + "...";
        patternsFound[patternName] = (patternsFound[patternName] || 0) + 1;
      }
    }
  }
  
  console.log("Most common reporting line patterns found:");
  const sortedPatterns = Object.entries(patternsFound).sort((a, b) => b[1] - a[1]);
  for (const [pattern, count] of sortedPatterns.slice(0, 10)) {
    console.log(`  ${count} matches: ${pattern}`);
  }
  
  // Summary
  console.log("\n=== Summary ===");
  console.log(`Total analyzed: 150 jobs`);
  console.log(`With reporting line info: ${hasReportingLineInRawText} (${((hasReportingLineInRawText/150)*100).toFixed(1)}%)`);
  console.log(`Correctly extracted: ${extractedSuccessfully}`);
  console.log(`Missed by extraction: ${extractedMissing}`);
  console.log(`\nExtraction gap: ${((extractedMissing/Math.max(1, hasReportingLineInRawText))*100).toFixed(1)}% of jobs with reporting line info failed extraction`);
}

analyzeJobs();
