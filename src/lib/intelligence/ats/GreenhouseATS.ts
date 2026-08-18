/**
 * GreenhouseATS.ts
 *
 * P7-C Track A: Direct ATS Ingestion Slice for Greenhouse
 *
 * Ingests canonical job requisitions from Greenhouse direct ATS endpoint,
 * extracting role, company, location, employment type, description, posted date,
 * and requisition ID without third-party portal noise or anti-bot interference.
 */

export interface DirectAtsRequisition {
  id: string;
  source: "Greenhouse";
  boardToken: string;
  canonicalTitle: string;
  companyName: string;
  location: string;
  employmentType?: string;
  contentHtml: string;
  contentText: string;
  postedAtIso?: string;
  applyUrl: string;
  fingerprint: string;
  isSparseSpec: boolean;
}

/**
 * Parses and normalizes a Greenhouse job requisition payload.
 */
export function normalizeGreenhouseRequisition(payload: {
  id: number | string;
  title: string;
  company_name?: string;
  board_token?: string;
  location?: { name: string };
  employment_type?: string;
  content?: string; // HTML description
  updated_at?: string;
  absolute_url?: string;
}): DirectAtsRequisition {
  const company = payload.company_name || payload.board_token || "Target Employer";
  const title = payload.title.trim();
  const location = payload.location?.name || "Remote / Unspecified";

  // Strip HTML for raw text JD
  const rawHtml = payload.content || "";
  const rawText = rawHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  // Deterministic fingerprint for deduplication
  const fingerprint = `gh-${payload.board_token || 'general'}-${payload.id}`;

  // Sparse spec check (< 120 characters of text content)
  const isSparseSpec = rawText.length < 120;

  return {
    id: String(payload.id),
    source: "Greenhouse",
    boardToken: payload.board_token || "unknown",
    canonicalTitle: title,
    companyName: company,
    location,
    employmentType: payload.employment_type || "Full-time",
    contentHtml: rawHtml,
    contentText: rawText,
    postedAtIso: payload.updated_at || undefined,
    applyUrl: payload.absolute_url || `https://boards.greenhouse.io/${payload.board_token}/jobs/${payload.id}`,
    fingerprint,
    isSparseSpec,
  };
}

/**
 * Simulates direct ATS fetch from public Greenhouse board API.
 */
export async function fetchGreenhouseRequisition(boardToken: string, jobId: string): Promise<DirectAtsRequisition> {
  const mockPayload = {
    id: jobId,
    title: "Vice President & General Manager - Digital Business",
    company_name: "Acme Enterprise Solutions",
    board_token: boardToken,
    location: { name: "Bengaluru, India (Hybrid)" },
    employment_type: "Full-time",
    updated_at: new Date().toISOString(),
    absolute_url: `https://boards.greenhouse.io/${boardToken}/jobs/${jobId}`,
    content: `
      <div>
        <h2>Role Overview</h2>
        <p>We are seeking a Vice President & GM to lead digital business transformation across India and APAC. Reports directly to global CEO and Board of Directors.</p>
        <h2>Key Responsibilities</h2>
        <ul>
          <li>P&L ownership of $120M annual recurring revenue portfolio.</li>
          <li>Lead 350+ engineering, product, and commercial professionals.</li>
          <li>Drive digital strategy and enterprise client expansion.</li>
        </ul>
      </div>
    `,
  };

  return normalizeGreenhouseRequisition(mockPayload);
}
