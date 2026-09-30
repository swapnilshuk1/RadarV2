/** Editable, template-aware DOCX rendering for an approved résumé. */
import { resumeMetrics } from "../resume-metrics";
import type { ResumeContent, ResumeTemplateId } from "../types";
import { createZip } from "./zip";

export interface ResumeDocxOptions {
  template?: ResumeTemplateId;
  metricGrid?: boolean;
}

interface Theme {
  font: string;
  heading: string;
  accent: string;
  muted: string;
  rule: string;
  panel: string;
  marker: string;
  grid: "BOXED" | "OPEN" | "LIST";
  nameSize: number;
  labels: { summary: string; impact: string; metrics: string; experience: string; capabilities: string };
}

const THEMES: Record<ResumeTemplateId, Theme> = {
  EXECUTIVE_BRIEF: {
    font: "Arial", heading: "1F365E", accent: "C2541C", muted: "707781", rule: "C9D1DB",
    panel: "F7F8FA", marker: "■", grid: "BOXED", nameSize: 42,
    labels: { summary: "About me", impact: "What I would bring", metrics: "By the numbers", experience: "Professional experience", capabilities: "Capabilities" },
  },
  EDITORIAL: {
    font: "Georgia", heading: "212124", accent: "594A38", muted: "6B6B70", rule: "C7C2BA",
    panel: "F9F7F4", marker: "•", grid: "OPEN", nameSize: 46,
    labels: { summary: "Profile", impact: "Selected impact", metrics: "Selected numbers", experience: "Experience", capabilities: "Capabilities" },
  },
  ATS_PLAIN: {
    font: "Arial", heading: "000000", accent: "000000", muted: "404040", rule: "999999",
    panel: "FFFFFF", marker: "-", grid: "LIST", nameSize: 32,
    labels: { summary: "Summary", impact: "Highlights", metrics: "Key metrics", experience: "Experience", capabilities: "Skills" },
  },
};

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const run = (text: string, options: { bold?: boolean; italic?: boolean; size?: number; caps?: boolean; color?: string } = {}) =>
  "<w:r><w:rPr>" +
  (options.bold ? "<w:b/>" : "") +
  (options.italic ? "<w:i/>" : "") +
  (options.caps ? "<w:caps/>" : "") +
  (options.color ? '<w:color w:val="' + options.color + '"/>' : "") +
  '<w:sz w:val="' + String(options.size ?? 20) + '"/></w:rPr><w:t xml:space="preserve">' +
  escape(text) + "</w:t></w:r>";

const paragraph = (
  runs: string,
  options: { align?: "center" | "left" | "right"; before?: number; after?: number; bullet?: boolean; keepNext?: boolean; border?: string; tab?: number } = {},
) =>
  "<w:p><w:pPr>" +
  (options.align ? '<w:jc w:val="' + options.align + '"/>' : "") +
  (options.tab ? '<w:tabs><w:tab w:val="right" w:pos="' + String(options.tab) + '"/></w:tabs>' : "") +
  (options.bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : "") +
  (options.keepNext ? "<w:keepNext/>" : "") +
  (options.border ? '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="3" w:color="' + options.border + '"/></w:pBdr>' : "") +
  '<w:spacing w:before="' + String(options.before ?? 0) + '" w:after="' + String(options.after ?? 80) + '"/></w:pPr>' +
  runs + "</w:p>";

const heading = (text: string, theme: Theme, plain: boolean) =>
  paragraph(run(text, { bold: true, size: plain ? 20 : 17, caps: true, color: theme.heading }), {
    before: 240, after: 100, keepNext: true, border: plain ? undefined : theme.rule,
  });

const metricTable = (resume: ResumeContent, theme: Theme, enabled: boolean): string => {
  const metrics = enabled ? resumeMetrics(resume) : [];
  if (metrics.length < 3) return "";
  if (theme.grid === "LIST") {
    return metrics.map((metric) =>
      paragraph(run(metric.value + " — ", { bold: true }) + run(metric.caption), { after: 40 }),
    ).join("");
  }
  const widths = [2437, 2437, 2436, 2436];
  const rows: string[] = [];
  const visible = metrics.slice(0, 8);
  for (let start = 0; start < visible.length; start += 4) {
    const cells = visible.slice(start, start + 4);
    while (cells.length < 4) cells.push({ value: "", caption: "", claimId: null });
    rows.push(
      "<w:tr>" +
      cells.map((metric, index) =>
        '<w:tc><w:tcPr><w:tcW w:w="' + String(widths[index]) + '" w:type="dxa"/>' +
        (theme.grid === "BOXED"
          ? '<w:shd w:val="clear" w:fill="' + theme.panel + '"/><w:tcBorders><w:top w:val="single" w:sz="3" w:color="' + theme.rule + '"/><w:left w:val="single" w:sz="3" w:color="' + theme.rule + '"/><w:bottom w:val="single" w:sz="3" w:color="' + theme.rule + '"/><w:right w:val="single" w:sz="3" w:color="' + theme.rule + '"/></w:tcBorders>'
          : "") +
        "</w:tcPr>" +
        paragraph(run(metric.value, { bold: true, size: 27, color: theme.accent }), { after: 30 }) +
        paragraph(run(metric.caption, { size: 15, color: theme.muted }), { after: 20 }) +
        "</w:tc>",
      ).join("") +
      "</w:tr>",
    );
  }
  return '<w:tbl><w:tblPr><w:tblW w:w="9746" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' +
    widths.map((width) => '<w:gridCol w:w="' + String(width) + '"/>').join("") +
    "</w:tblGrid>" + rows.join("") + "</w:tbl>";
};

export function resumeToDocx(resume: ResumeContent, options: ResumeDocxOptions = {}): Uint8Array {
  const template = options.template ?? "EXECUTIVE_BRIEF";
  const theme = THEMES[template];
  const plain = template === "ATS_PLAIN";
  const body: string[] = [];

  body.push(paragraph(run(resume.fullName, { bold: true, size: theme.nameSize, caps: !plain, color: theme.heading }), { after: 35 }));
  if (resume.headline)
    body.push(paragraph(run(resume.headline, { bold: !plain && template !== "EDITORIAL", italic: template === "EDITORIAL", size: 22, color: plain ? theme.heading : theme.accent }), { after: 35 }));
  if (resume.contactLine)
    body.push(paragraph(run(resume.contactLine, { size: 17, color: theme.muted }), { after: 100, border: plain ? undefined : theme.rule }));

  if (resume.executiveSummary) {
    body.push(heading(theme.labels.summary, theme, plain));
    body.push(paragraph(run(resume.executiveSummary.replace(/\n/g, " ").trim()), { after: 90 }));
  }
  if (resume.impactAnchors.length) {
    body.push(heading(theme.labels.impact, theme, plain));
    for (const item of resume.impactAnchors) body.push(paragraph(run(item.text), { bullet: true, after: 70 }));
  }

  const metrics = metricTable(resume, theme, options.metricGrid !== false);
  if (metrics) body.push(heading(theme.labels.metrics, theme, plain), metrics);

  if (resume.roles.length) {
    body.push(heading(theme.labels.experience, theme, plain));
    for (const role of resume.roles) {
      const title = [role.roleTitle, role.employer].filter(Boolean).join(plain ? " — " : " | ");
      body.push(paragraph(
        run(title, { bold: true, size: 21, color: theme.heading }) +
        (role.period ? '<w:r><w:tab/></w:r>' + run(role.period, { bold: !plain, size: 17, color: theme.heading }) : ""),
        { after: 45, keepNext: true, tab: 9746 },
      ));
      for (const item of role.bullets) body.push(paragraph(run(item.text), { bullet: true, after: 55 }));
    }
  }

  if (resume.capabilities.length) {
    body.push(heading(theme.labels.capabilities, theme, plain));
    body.push(paragraph(run(resume.capabilities.join(plain ? ", " : "  ·  "))));
  }

  const furniture = plain ? "" : '<w:headerReference w:type="default" r:id="rId3"/><w:footerReference w:type="default" r:id="rId4"/><w:titlePg/>';
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    "<w:body>" + body.join("") + "<w:sectPr>" + furniture +
    '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="500" w:footer="500"/>' +
    "</w:sectPr></w:body></w:document>";

  const numbering =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="' + escape(theme.marker) + '"/><w:pPr><w:ind w:left="360" w:hanging="220"/></w:pPr></w:lvl></w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="' + theme.font + '" w:hAnsi="' + theme.font + '"/><w:color w:val="212124"/><w:sz w:val="19"/>' +
    '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="260" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>';

  const header =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    paragraph(run(resume.fullName, { bold: true, caps: true, size: 15, color: theme.muted }), { after: 0 }) + "</w:hdr>";
  const footer =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    paragraph(run(resume.fullName + " — page ", { size: 15, color: theme.muted }) + '<w:fldSimple w:instr="PAGE">' + run("1", { size: 15, color: theme.muted }) + "</w:fldSimple>", { align: "right", after: 0 }) +
    "</w:ftr>";

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    (plain ? "" : '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>') +
    "</Types>";

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    (plain ? "" : '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>') +
    "</Relationships>";

  return createZip([
    { path: "[Content_Types].xml", content: contentTypes },
    { path: "_rels/.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { path: "word/_rels/document.xml.rels", content: rels },
    { path: "word/document.xml", content: document },
    { path: "word/numbering.xml", content: numbering },
    { path: "word/styles.xml", content: styles },
    ...(!plain ? [{ path: "word/header1.xml", content: header }, { path: "word/footer1.xml", content: footer }] : []),
  ]);
}
