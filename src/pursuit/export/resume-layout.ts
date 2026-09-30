/** Template-aware, edge-safe PDF résumé renderer. */
import { resumeMetrics } from "../resume-metrics";
import type { ResumeContent, ResumeMetric, ResumeTemplateId } from "../types";

type FontKey = "serif" | "serifItalic" | "serifBold" | "sans" | "sansBold";
type RGB = [number, number, number];

const FONT_RESOURCE: Record<FontKey, { name: string; base: string; width: number }> = {
  serif: { name: "F1", base: "Times-Roman", width: 0.46 },
  serifItalic: { name: "F2", base: "Times-Italic", width: 0.45 },
  serifBold: { name: "F3", base: "Times-Bold", width: 0.49 },
  sans: { name: "F4", base: "Helvetica", width: 0.5 },
  sansBold: { name: "F5", base: "Helvetica-Bold", width: 0.54 },
};

interface Theme {
  body: FontKey;
  display: FontKey;
  italic: FontKey;
  heading: RGB;
  accent: RGB;
  muted: RGB;
  rule: RGB;
  panel: RGB;
  plain: boolean;
  labels: {
    summary: string;
    impact: string;
    metrics: string;
    experience: string;
    capabilities: string;
  };
}

const THEMES: Record<ResumeTemplateId, Theme> = {
  EXECUTIVE_BRIEF: {
    body: "sans",
    display: "sansBold",
    italic: "serifItalic",
    heading: [0.122, 0.212, 0.369],
    accent: [0.761, 0.329, 0.11],
    muted: [0.39, 0.43, 0.48],
    rule: [0.76, 0.8, 0.85],
    panel: [0.965, 0.972, 0.98],
    plain: false,
    labels: {
      summary: "About me",
      impact: "What I would bring",
      metrics: "By the numbers",
      experience: "Professional experience",
      capabilities: "Capabilities",
    },
  },
  EDITORIAL: {
    body: "serif",
    display: "serifBold",
    italic: "serifItalic",
    heading: [0.13, 0.13, 0.14],
    accent: [0.35, 0.29, 0.22],
    muted: [0.42, 0.42, 0.44],
    rule: [0.76, 0.74, 0.7],
    panel: [0.978, 0.969, 0.953],
    plain: false,
    labels: {
      summary: "Profile",
      impact: "Selected impact",
      metrics: "Selected numbers",
      experience: "Experience",
      capabilities: "Capabilities",
    },
  },
  ATS_PLAIN: {
    body: "sans",
    display: "sansBold",
    italic: "sans",
    heading: [0, 0, 0],
    accent: [0, 0, 0],
    muted: [0.25, 0.25, 0.25],
    rule: [0.55, 0.55, 0.55],
    panel: [1, 1, 1],
    plain: true,
    labels: {
      summary: "Summary",
      impact: "Highlights",
      metrics: "Key metrics",
      experience: "Experience",
      capabilities: "Skills",
    },
  },
};

export interface ResumePdfOptions {
  template?: ResumeTemplateId;
  metricGrid?: boolean;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 52;
const MARGIN_TOP = 54;
const MARGIN_BOTTOM = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

interface TextRun {
  kind: "text";
  text: string;
  font: FontKey;
  size: number;
  spaceBefore: number;
  leading: number;
  indent: number;
  tracking: number;
  color: RGB;
  keepWithNext: boolean;
}

interface RuleRun {
  kind: "rule";
  color: RGB;
  spaceBefore: number;
  spaceAfter: number;
}

interface MetricRun {
  kind: "metrics";
  metrics: ResumeMetric[];
  theme: Theme;
  spaceBefore: number;
}

type Block = TextRun | RuleRun | MetricRun;

class Doc {
  private blocks: Block[] = [];

  add(text: string, options: Partial<Omit<TextRun, "kind" | "text">> = {}): void {
    const size = options.size ?? 10.2;
    this.blocks.push({
      kind: "text",
      text: normalizePdfText(text),
      font: options.font ?? "serif",
      size,
      spaceBefore: options.spaceBefore ?? 0,
      leading: options.leading ?? size * 1.34,
      indent: options.indent ?? 0,
      tracking: options.tracking ?? 0,
      color: options.color ?? [0.06, 0.07, 0.09],
      keepWithNext: options.keepWithNext ?? false,
    });
  }

  rule(color: RGB, spaceBefore = 7, spaceAfter = 5): void {
    this.blocks.push({ kind: "rule", color, spaceBefore, spaceAfter });
  }

  metrics(metrics: ResumeMetric[], theme: Theme): void {
    this.blocks.push({ kind: "metrics", metrics, theme, spaceBefore: 5 });
  }

  private wrap(run: TextRun): string[] {
    if (!run.text) return [""];
    const usable = CONTENT_WIDTH - run.indent;
    const charWidth = FONT_RESOURCE[run.font].width * run.size + run.tracking;
    const maxChars = Math.max(12, Math.floor(usable / charWidth));
    const words = run.text.replace(/\s+/g, " ").trim().split(" ");
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? line + " " + word : word;
      if (candidate.length <= maxChars) line = candidate;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  private textOp(text: string, font: FontKey, size: number, color: RGB, x: number, y: number, tracking = 0): string {
    return "BT /" + FONT_RESOURCE[font].name + " " + size.toFixed(2) + " Tf " +
      color.map((c) => c.toFixed(3)).join(" ") + " rg " + tracking.toFixed(2) + " Tc " +
      "1 0 0 1 " + x.toFixed(2) + " " + y.toFixed(2) + " Tm (" + escapePdfText(text) + ") Tj ET\n";
  }

  private metricOps(run: MetricRun, yTop: number): { stream: string; height: number } {
    const metrics = run.metrics.slice(0, 4);
    const cols = Math.max(1, metrics.length);
    const gap = 8;
    const width = (CONTENT_WIDTH - gap * (cols - 1)) / cols;
    const height = run.theme.plain ? 42 : 58;
    let stream = "";
    metrics.forEach((metric, index) => {
      const x = MARGIN_X + index * (width + gap);
      if (!run.theme.plain) {
        stream += "q " + run.theme.panel.map((c) => c.toFixed(3)).join(" ") + " rg " +
          x.toFixed(2) + " " + (yTop - height).toFixed(2) + " " + width.toFixed(2) + " " + height.toFixed(2) + " re f Q\n";
        stream += "q " + run.theme.rule.map((c) => c.toFixed(3)).join(" ") + " RG 0.45 w " +
          x.toFixed(2) + " " + (yTop - height).toFixed(2) + " " + width.toFixed(2) + " " + height.toFixed(2) + " re S Q\n";
      }
      stream += this.textOp(metric.value, "sansBold", run.theme.plain ? 12 : 16, run.theme.accent, x + 8, yTop - 20);
      const caption = normalizePdfText(metric.caption);
      const max = Math.max(16, Math.floor((width - 16) / (0.48 * 7.4)));
      const shown = caption.length > max ? caption.slice(0, Math.max(0, max - 1)).trimEnd() + "…" : caption;
      stream += this.textOp(shown, "sans", 7.4, run.theme.muted, x + 8, yTop - 37);
    });
    return { stream, height };
  }

  private paginate(): string[] {
    const pages: string[] = [];
    let stream = "";
    let y = PAGE_HEIGHT - MARGIN_TOP;
    const flush = () => {
      if (stream.length) pages.push(stream);
      stream = "";
      y = PAGE_HEIGHT - MARGIN_TOP;
    };

    for (let blockIndex = 0; blockIndex < this.blocks.length; blockIndex++) {
      const block = this.blocks[blockIndex]!;
      if (block.kind === "rule") {
        y -= block.spaceBefore;
        if (y - block.spaceAfter < MARGIN_BOTTOM) flush();
        stream += "q " + block.color.map((c) => c.toFixed(3)).join(" ") + " RG 0.6 w " +
          MARGIN_X.toFixed(2) + " " + y.toFixed(2) + " m " + (PAGE_WIDTH - MARGIN_X).toFixed(2) + " " + y.toFixed(2) + " l S Q\n";
        y -= block.spaceAfter;
        continue;
      }
      if (block.kind === "metrics") {
        y -= block.spaceBefore;
        const height = block.theme.plain ? 42 : 58;
        if (y - height < MARGIN_BOTTOM) flush();
        const rendered = this.metricOps(block, y);
        stream += rendered.stream;
        y -= rendered.height;
        continue;
      }

      y -= block.spaceBefore;
      const lines = this.wrap(block);
      if (block.keepWithNext && y - block.leading * Math.max(2, lines.length + 1) < MARGIN_BOTTOM) flush();
      for (const [index, line] of lines.entries()) {
        if (y - block.leading < MARGIN_BOTTOM) flush();
        y -= block.leading;
        if (!line) continue;
        const indent = block.indent + (index > 0 && block.indent > 0 ? 9 : 0);
        stream += this.textOp(line, block.font, block.size, block.color, MARGIN_X + indent, y, block.tracking);
      }
    }
    flush();
    return pages.length ? pages : [""];
  }

  build(title: string): Uint8Array {
    const pages = this.paginate();
    const objects: string[] = [];
    const push = (body: string): number => {
      objects.push(body);
      return objects.length;
    };
    const fontIds = (Object.keys(FONT_RESOURCE) as FontKey[]).map((key) => ({
      key,
      id: push("<< /Type /Font /Subtype /Type1 /BaseFont /" + FONT_RESOURCE[key].base + " /Encoding /WinAnsiEncoding >>"),
    }));
    const resources = "<< /Font << " + fontIds.map(({ key, id }) => "/" + FONT_RESOURCE[key].name + " " + id + " 0 R").join(" ") + " >> >>";
    const contentIds = pages.map((page) => push("<< /Length " + byteLength(page) + " >>\nstream\n" + page + "endstream"));
    const pagesObjectNumber = objects.length + pages.length + 1;
    const pageIds = pages.map((_, index) =>
      push("<< /Type /Page /Parent " + pagesObjectNumber + " 0 R /MediaBox [0 0 " + PAGE_WIDTH + " " + PAGE_HEIGHT + "] /Resources " + resources + " /Contents " + contentIds[index] + " 0 R >>"),
    );
    const pagesId = push("<< /Type /Pages /Count " + pageIds.length + " /Kids [" + pageIds.map((id) => id + " 0 R").join(" ") + "] >>");
    const infoId = push("<< /Title (" + escapePdfText(title) + ") /Producer (RADAR Pursuit Cockpit) >>");
    const catalogId = push("<< /Type /Catalog /Pages " + pagesId + " 0 R >>");

    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((body, index) => {
      offsets.push(byteLength(pdf));
      pdf += String(index + 1) + " 0 obj\n" + body + "\nendobj\n";
    });
    const xrefOffset = byteLength(pdf);
    pdf += "xref\n0 " + String(objects.length + 1) + "\n0000000000 65535 f \n";
    offsets.forEach((offset) => {
      pdf += offset.toString().padStart(10, "0") + " 00000 n \n";
    });
    pdf += "trailer\n<< /Size " + String(objects.length + 1) + " /Root " + catalogId + " 0 R /Info " + infoId + " 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF\n";
    return new TextEncoder().encode(pdf);
  }
}

const byteLength = (value: string): number => new TextEncoder().encode(value).length;

function normalizePdfText(value: string): string {
  const normalized = value
    .replace(/₹/g, "INR ")
    .replace(/€/g, "EUR ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u00A0\u202F]/g, " ")
    .replace(/[\u2022\u25CF]/g, "-")
    .replace(/\u2026/g, "...");
  for (const char of normalized) {
    const code = char.codePointAt(0) ?? 0;
    if (code !== 9 && code !== 10 && code !== 13 && (code < 32 || (code > 126 && code < 160) || code > 255)) {
      throw new Error("PDF_EXPORT_UNSUPPORTED_CHARACTER: " + char + " (U+" + code.toString(16).toUpperCase() + "). Use DOCX or TXT export for this text.");
    }
  }
  return normalized;
}

function escapePdfText(value: string): string {
  const normalized = normalizePdfText(value);
  let out = "";
  for (const char of normalized) {
    const code = char.codePointAt(0) ?? 32;
    if (char === "(" || char === ")" || char === "\\") out += "\\" + char;
    else if (code < 32) out += " ";
    else if (code < 128) out += char;
    else out += "\\" + code.toString(8).padStart(3, "0");
  }
  return out;
}

const section = (doc: Doc, theme: Theme, label: string) => {
  doc.add(label.toUpperCase(), {
    font: "sansBold",
    size: 7.4,
    tracking: theme.plain ? 0.4 : 1.35,
    spaceBefore: 13,
    leading: 10.5,
    color: theme.muted,
    keepWithNext: true,
  });
  if (!theme.plain) doc.rule(theme.rule, 2, 4);
};

export function resumeToPdf(resume: ResumeContent, options: ResumePdfOptions = {}): Uint8Array {
  const template = options.template ?? "EXECUTIVE_BRIEF";
  const theme = THEMES[template];
  const doc = new Doc();

  doc.add(resume.fullName, {
    font: theme.display,
    size: template === "ATS_PLAIN" ? 18 : 22,
    leading: 25,
    color: theme.heading,
  });
  if (resume.headline) {
    doc.add(resume.headline, {
      font: template === "EDITORIAL" ? theme.italic : theme.display,
      size: 10.8,
      leading: 14,
      spaceBefore: 2,
      color: theme.accent,
    });
  }
  if (resume.contactLine) {
    doc.add(resume.contactLine, { font: "sans", size: 8.2, leading: 11, spaceBefore: 3, color: theme.muted });
  }
  doc.rule(theme.rule, 7, 4);

  if (resume.executiveSummary) {
    section(doc, theme, theme.labels.summary);
    doc.add(resume.executiveSummary, { font: theme.body, size: 9.8, leading: 14.2, color: [0.08, 0.09, 0.11] });
  }

  if (resume.impactAnchors.length) {
    section(doc, theme, theme.labels.impact);
    for (const anchor of resume.impactAnchors) {
      doc.add("•  " + anchor.text, { font: theme.body, size: 9.6, leading: 13.8, indent: 4, spaceBefore: 2 });
    }
  }

  const metrics = options.metricGrid === false ? [] : resumeMetrics(resume);
  if (metrics.length >= 3) {
    section(doc, theme, theme.labels.metrics);
    doc.metrics(metrics, theme);
  }

  if (resume.roles.length) {
    section(doc, theme, theme.labels.experience);
    for (const role of resume.roles) {
      const title = [role.roleTitle, role.employer].filter(Boolean).join(template === "ATS_PLAIN" ? " - " : "  |  ");
      doc.add(title, { font: theme.display, size: 10.4, leading: 13.5, spaceBefore: 8, color: theme.heading, keepWithNext: true });
      if (role.period) doc.add(role.period, { font: "sans", size: 7.8, leading: 10, color: theme.muted, keepWithNext: true });
      for (const bullet of role.bullets) {
        doc.add("•  " + bullet.text, { font: theme.body, size: 9.4, leading: 13.4, indent: 4, spaceBefore: 1.5 });
      }
    }
  }

  if (resume.capabilities.length) {
    section(doc, theme, theme.labels.capabilities);
    doc.add(resume.capabilities.join(template === "ATS_PLAIN" ? ", " : "  ·  "), { font: theme.body, size: 9.2, leading: 13 });
  }

  return doc.build(resume.fullName + " — Resume");
}
