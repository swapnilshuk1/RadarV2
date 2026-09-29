/**
 * src/pursuit/export/docx.ts
 *
 * Renders a tailored resume to DOCX.
 *
 * DOCX matters because executive search consultants and portals routinely
 * reformat, annotate or parse the document. A PDF is the artefact you send to a
 * principal; a DOCX is the one that survives a search firm's process.
 */

import { createZip } from "./zip";
import type { ResumeContent } from "../types";

const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const run = (text: string, options: { bold?: boolean; size?: number; caps?: boolean } = {}) =>
  `<w:r><w:rPr>${options.bold ? "<w:b/>" : ""}${
    options.caps ? "<w:caps/>" : ""
  }<w:sz w:val="${options.size ?? 20}"/></w:rPr><w:t xml:space="preserve">${escape(text)}</w:t></w:r>`;

const paragraph = (
  runs: string,
  options: { align?: "center" | "left"; spaceAfter?: number; bullet?: boolean } = {},
) =>
  `<w:p><w:pPr>${
    options.align === "center" ? '<w:jc w:val="center"/>' : ""
  }${options.bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ""}<w:spacing w:after="${
    options.spaceAfter ?? 80
  }"/></w:pPr>${runs}</w:p>`;

const heading = (text: string) =>
  `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="999999"/></w:pBdr><w:spacing w:before="220" w:after="120"/></w:pPr>${run(
    text,
    { bold: true, size: 20, caps: true },
  )}</w:p>`;

export function resumeToDocx(resume: ResumeContent): Uint8Array {
  const body: string[] = [];

  body.push(paragraph(run(resume.fullName, { bold: true, size: 36 }), { align: "center", spaceAfter: 40 }));
  if (resume.contactLine) {
    body.push(paragraph(run(resume.contactLine, { size: 18 }), { align: "center", spaceAfter: 60 }));
  }
  if (resume.headline) {
    body.push(paragraph(run(resume.headline, { bold: true, size: 22 }), { align: "center", spaceAfter: 140 }));
  }

  if (resume.executiveSummary) {
    body.push(heading("Executive Summary"));
    body.push(paragraph(run(resume.executiveSummary)));
  }

  if (resume.impactAnchors.length > 0) {
    body.push(heading("Selected Impact"));
    for (const anchor of resume.impactAnchors) {
      body.push(paragraph(run(anchor.text), { bullet: true }));
    }
  }

  if (resume.roles.length > 0) {
    body.push(heading("Experience"));
    for (const role of resume.roles) {
      body.push(
        paragraph(
          `${run(role.roleTitle, { bold: true })}${run(
            role.employer ? ` — ${role.employer}` : "",
          )}${role.period ? run(`   ${role.period}`, { size: 18 }) : ""}`,
          { spaceAfter: 40 },
        ),
      );
      for (const bullet of role.bullets) {
        body.push(paragraph(run(bullet.text), { bullet: true, spaceAfter: 40 }));
      }
    }
  }

  if (resume.capabilities.length > 0) {
    body.push(heading("Capabilities"));
    body.push(paragraph(run(resume.capabilities.join("  ·  "))));
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body>
</w:document>`;

  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="360" w:hanging="220"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>
</w:styles>`;

  return createZip([
    {
      path: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
    },
    {
      path: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      path: "word/_rels/document.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { path: "word/document.xml", content: document },
    { path: "word/numbering.xml", content: numbering },
    { path: "word/styles.xml", content: styles },
  ]);
}
