/**
 * src/pursuit/export/pdf.ts
 *
 * Dependency-free PDF writer for pursuit artifacts.
 *
 * Why hand-rolled: the server runs on Cloudflare Workers, where the usual PDF
 * libraries either need Node internals or ship large WASM payloads. We only need
 * left-aligned text in the PDF base-14 fonts, which the format supports directly
 * with no embedding, so a few hundred lines removes an entire dependency risk.
 */

import type { InterviewBriefContent, MessageContent, ResumeContent } from "../types";

type FontKey = "body" | "bodyItalic" | "bold" | "sans" | "sansBold";

const FONT_RESOURCE: Record<FontKey, { name: string; base: string }> = {
  body: { name: "F1", base: "Times-Roman" },
  bodyItalic: { name: "F2", base: "Times-Italic" },
  bold: { name: "F3", base: "Times-Bold" },
  sans: { name: "F4", base: "Helvetica" },
  sansBold: { name: "F5", base: "Helvetica-Bold" },
};

/**
 * Average glyph width as a fraction of font size, per font. Used only for line
 * breaking; the PDF viewer does the real metrics. Slightly conservative so lines
 * never overrun the right margin.
 */
const AVG_WIDTH: Record<FontKey, number> = {
  body: 0.46,
  bodyItalic: 0.45,
  bold: 0.49,
  sans: 0.5,
  sansBold: 0.54,
};

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 56;
const MARGIN_TOP = 64;
const MARGIN_BOTTOM = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

interface TextRun {
  text: string;
  font: FontKey;
  size: number;
  /** Space above this block, in points. */
  spaceBefore: number;
  leading: number;
  indent: number;
  /** Tracking in points, for small-caps style section labels. */
  tracking: number;
  color: [number, number, number];
}

const BLACK: [number, number, number] = [0.06, 0.08, 0.11];
const MUTED: [number, number, number] = [0.38, 0.41, 0.46];

class Doc {
  private runs: TextRun[] = [];

  add(text: string, options: Partial<Omit<TextRun, "text">> = {}): void {
    this.runs.push({
      text,
      font: options.font ?? "body",
      size: options.size ?? 10.5,
      spaceBefore: options.spaceBefore ?? 0,
      leading: options.leading ?? (options.size ?? 10.5) * 1.35,
      indent: options.indent ?? 0,
      tracking: options.tracking ?? 0,
      color: options.color ?? BLACK,
    });
  }

  rule(): void {
    // Rendered as a run of underscores: keeps the writer to a single content
    // operator set without a separate graphics path.
    this.add("", { spaceBefore: 6, size: 1, leading: 1 });
    this.runs.push({
      text: "\u2014".repeat(46),
      font: "body",
      size: 8,
      spaceBefore: 0,
      leading: 8,
      indent: 0,
      tracking: 0,
      color: [0.82, 0.84, 0.86],
    });
  }

  blank(points = 8): void {
    this.add("", { size: 1, leading: points });
  }

  private wrap(run: TextRun): string[] {
    if (run.text.length === 0) return [""];
    const usable = CONTENT_WIDTH - run.indent;
    const charWidth = AVG_WIDTH[run.font] * run.size + run.tracking;
    const maxChars = Math.max(12, Math.floor(usable / charWidth));
    const words = run.text.replace(/\s+/g, " ").trim().split(" ");
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= maxChars) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines.length > 0 ? lines : [""];
  }

  /** Lays runs into pages and returns each page's content stream. */
  private paginate(): string[] {
    const pages: string[] = [];
    let stream = "";
    let y = PAGE_HEIGHT - MARGIN_TOP;

    const flush = () => {
      if (stream.length > 0) pages.push(stream);
      stream = "";
      y = PAGE_HEIGHT - MARGIN_TOP;
    };

    for (const run of this.runs) {
      y -= run.spaceBefore;
      const lines = this.wrap(run);
      for (const [index, line] of lines.entries()) {
        if (y - run.leading < MARGIN_BOTTOM) flush();
        y -= run.leading;
        if (line.length === 0) continue;
        // Hanging indent: continuation lines of a bullet align past the marker.
        const indent = run.indent + (index > 0 && run.indent > 0 ? 10 : 0);
        stream +=
          `BT /${FONT_RESOURCE[run.font].name} ${run.size.toFixed(2)} Tf ` +
          `${run.color.map((c) => c.toFixed(3)).join(" ")} rg ` +
          `${run.tracking !== 0 ? `${run.tracking.toFixed(2)} Tc ` : "0 Tc "}` +
          `1 0 0 1 ${(MARGIN_X + indent).toFixed(2)} ${y.toFixed(2)} Tm ` +
          `(${escapePdfText(line)}) Tj ET\n`;
      }
    }
    flush();
    return pages.length > 0 ? pages : [""];
  }

  build(title: string): Uint8Array {
    const pages = this.paginate();
    const objects: string[] = [];
    const push = (body: string): number => {
      objects.push(body);
      return objects.length; // 1-indexed object number
    };

    const fontIds = (Object.keys(FONT_RESOURCE) as FontKey[]).map((key) => ({
      key,
      id: push(
        `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_RESOURCE[key].base} /Encoding /WinAnsiEncoding >>`,
      ),
    }));
    const resources = `<< /Font << ${fontIds
      .map(({ key, id }) => `/${FONT_RESOURCE[key].name} ${id} 0 R`)
      .join(" ")} >> >>`;

    const contentIds = pages.map((page) =>
      push(`<< /Length ${byteLength(page)} >>\nstream\n${page}endstream`),
    );

    // Pages object number must be known by each page; reserve it first.
    const pagesObjectNumber = objects.length + pages.length + 1;
    const pageIds = pages.map((_, index) =>
      push(
        `<< /Type /Page /Parent ${pagesObjectNumber} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources ${resources} /Contents ${contentIds[index]} 0 R >>`,
      ),
    );
    const pagesId = push(
      `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`,
    );
    const infoId = push(
      `<< /Title (${escapePdfText(title)}) /Producer (RADAR Pursuit Cockpit) >>`,
    );
    const catalogId = push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [];
    for (const [index, body] of objects.entries()) {
      offsets.push(byteLength(pdf));
      pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    }
    const xrefOffset = byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
      pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
    }
    pdf +=
      `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`;

    return new TextEncoder().encode(pdf);
  }
}

const byteLength = (value: string): number => new TextEncoder().encode(value).length;

/** WinAnsi-safe escaping; unsupported glyphs degrade to sensible ASCII. */
function escapePdfText(value: string): string {
  const normalised = value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2022/g, "\u2022")
    .replace(/[\u2013]/g, "-")
    .replace(/\u00A0/g, " ");
  let out = "";
  for (const char of normalised) {
    const code = char.codePointAt(0) ?? 32;
    if (char === "(" || char === ")" || char === "\\") out += `\\${char}`;
    else if (code < 32) out += " ";
    else if (code < 128) out += char;
    else if (code < 256) out += `\\${code.toString(8).padStart(3, "0")}`;
    else if (char === "\u2014") out += "\\227";
    else if (char === "\u2022") out += "\\267";
    else if (char === "\u00B7") out += "\\267";
    else out += "?";
  }
  return out;
}

// ---------------------------------------------------------------------------
// Artifact layouts
// ---------------------------------------------------------------------------

function sectionLabel(doc: Doc, label: string): void {
  doc.add(label.toUpperCase(), {
    font: "sansBold",
    size: 7.6,
    tracking: 1.6,
    spaceBefore: 16,
    leading: 12,
    color: MUTED,
  });
}

export function resumeToPdf(resume: ResumeContent): Uint8Array {
  const doc = new Doc();
  doc.add(resume.fullName, { font: "bold", size: 21, leading: 25 });
  if (resume.headline) {
    doc.add(resume.headline, { font: "bodyItalic", size: 11, leading: 15, spaceBefore: 2 });
  }
  if (resume.contactLine) {
    doc.add(resume.contactLine, { font: "sans", size: 8.8, leading: 12, spaceBefore: 4, color: MUTED });
  }
  doc.rule();

  if (resume.executiveSummary) {
    sectionLabel(doc, "Executive Summary");
    doc.add(resume.executiveSummary, { size: 10.5, leading: 15.5, spaceBefore: 2 });
  }

  if (resume.impactAnchors.length > 0) {
    sectionLabel(doc, "Selected Impact");
    for (const anchor of resume.impactAnchors) {
      doc.add(`\u2022  ${anchor.text}`, { size: 10.5, leading: 15, indent: 4, spaceBefore: 3 });
    }
  }

  if (resume.roles.length > 0) {
    sectionLabel(doc, "Experience");
    for (const role of resume.roles) {
      const heading = [role.roleTitle, role.employer].filter(Boolean).join("  \u00B7  ");
      doc.add(heading, { font: "bold", size: 11, leading: 15, spaceBefore: 10 });
      if (role.period) {
        doc.add(role.period, { font: "sans", size: 8.4, leading: 11, color: MUTED });
      }
      for (const bullet of role.bullets) {
        doc.add(`\u2022  ${bullet.text}`, { size: 10.2, leading: 14.6, indent: 4, spaceBefore: 2 });
      }
    }
  }

  if (resume.capabilities.length > 0) {
    sectionLabel(doc, "Capabilities");
    doc.add(resume.capabilities.join("  \u00B7  "), { size: 10, leading: 14.5, spaceBefore: 2 });
  }

  return doc.build(`${resume.fullName} — Resume`);
}

export function messageToPdf(message: MessageContent, title: string): Uint8Array {
  const doc = new Doc();
  doc.add(title, { font: "bold", size: 15, leading: 20 });
  if (message.subject) {
    doc.add(`Subject: ${message.subject}`, {
      font: "sans",
      size: 9.2,
      leading: 13,
      spaceBefore: 4,
      color: MUTED,
    });
  }
  doc.rule();
  for (const paragraph of message.body.split(/\n{2,}/)) {
    doc.add(paragraph.replace(/\n/g, " "), { size: 10.8, leading: 16, spaceBefore: 8 });
  }
  return doc.build(title);
}

export function interviewBriefToPdf(brief: InterviewBriefContent, title: string): Uint8Array {
  const doc = new Doc();
  doc.add(title, { font: "bold", size: 18, leading: 23 });
  doc.rule();

  sectionLabel(doc, "The Mandate");
  doc.add(brief.mandateSentence, { size: 11, leading: 16, spaceBefore: 2 });

  brief.proofStories.forEach((story, index) => {
    sectionLabel(doc, `Proof Story ${index + 1}`);
    doc.add(story.title, { font: "bold", size: 11, leading: 15, spaceBefore: 2 });
    const rows: Array<[string, string]> = [
      ["Challenge", story.challenge],
      ["Action", story.action],
      ["Scale", story.scale],
      ["Result", story.result],
      ["Relevance", story.relevance],
    ];
    for (const [label, value] of rows) {
      doc.add(`${label}: ${value}`, { size: 10.2, leading: 14.6, indent: 4, spaceBefore: 3 });
    }
  });

  const lists: Array<[string, readonly string[]]> = [
    ["Questions To Ask", brief.questionsToAsk],
    ["First 90 Days — Hypotheses", brief.firstNinetyDays],
    ["Risks To Address", brief.risksToAddress],
  ];
  for (const [label, items] of lists) {
    if (items.length === 0) continue;
    sectionLabel(doc, label);
    for (const item of items) {
      doc.add(`\u2022  ${item}`, { size: 10.2, leading: 14.6, indent: 4, spaceBefore: 2 });
    }
  }

  return doc.build(title);
}
