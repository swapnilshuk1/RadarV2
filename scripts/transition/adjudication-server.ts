/**
 * adjudication-server.ts
 *
 * Standalone, lightweight HTTP server for non-technical human adjudicators.
 * Zero external framework dependencies.
 *
 * Provides 3 distinct role portals:
 * - Reviewer 1: http://localhost:4050/reviewer1
 * - Reviewer 2: http://localhost:4050/reviewer2
 * - Reconciler: http://localhost:4050/reconcile
 *
 * Runs via:
 *   npx tsx scripts/transition/adjudication-server.ts
 */

import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  validateRoleDocument,
  validateCandidateDocument
} from "./ingest-batch06-human-truth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../audit-reports/gate1b-batch06/annotation");
const PORT = Number(process.env.ADJUDICATION_PORT || 4050);

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(body));
}

function getBaseDir(holdout: string, type: string): string {
  const h = holdout.toLowerCase() === "secondary" ? "secondary" : "primary";
  const t = type.toLowerCase() === "candidates" ? "candidates" : "roles";
  return path.join(ROOT, h, t);
}

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = reqUrl.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  // Serve UI
  if (pathname === "/" || pathname === "/reviewer1" || pathname === "/reviewer2" || pathname === "/reconcile") {
    const htmlPath = path.join(__dirname, "adjudication-ui.html");
    if (!fs.existsSync(htmlPath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("adjudication-ui.html not found");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(htmlPath, "utf8"));
    return;
  }

  // API: Get document list
  if (pathname === "/api/documents" && req.method === "GET") {
    const holdout = reqUrl.searchParams.get("holdout") || "primary";
    const type = reqUrl.searchParams.get("type") || "roles";
    const dir = getBaseDir(holdout, type);

    if (!fs.existsSync(dir)) {
      return json(res, 404, { error: `Directory not found: ${dir}` });
    }

    const files = fs.readdirSync(dir);
    const blanks = files.filter(f => f.endsWith("_BLANK.json"));

    const list = blanks.map(blankFile => {
      const opaqueId = blankFile.replace("_BLANK.json", "");
      let blankData: any = {};
      try {
        blankData = JSON.parse(fs.readFileSync(path.join(dir, blankFile), "utf8"));
      } catch {}
      const rev1File = `${opaqueId}_REV1.json`;
      const rev2File = `${opaqueId}_REV2.json`;
      const recFile = `${opaqueId}_RECONCILIATION.json`;

      return {
        opaqueId,
        title: blankData.title || blankData.targetRole || opaqueId,
        company: blankData.company || blankData.targetCompany || "",
        hasRev1: fs.existsSync(path.join(dir, rev1File)),
        hasRev2: fs.existsSync(path.join(dir, rev2File)),
        hasReconciliation: fs.existsSync(path.join(dir, recFile))
      };
    });

    return json(res, 200, { holdout, type, total: list.length, documents: list });
  }

  // API: Get document detail
  if (pathname === "/api/document" && req.method === "GET") {
    const holdout = reqUrl.searchParams.get("holdout") || "primary";
    const type = reqUrl.searchParams.get("type") || "roles";
    const id = reqUrl.searchParams.get("id");

    if (!id) return json(res, 400, { error: "Missing document id parameter" });

    const dir = getBaseDir(holdout, type);
    const blankPath = path.join(dir, `${id}_BLANK.json`);
    const rev1Path = path.join(dir, `${id}_REV1.json`);
    const rev2Path = path.join(dir, `${id}_REV2.json`);
    const recPath = path.join(dir, `${id}_RECONCILIATION.json`);

    if (!fs.existsSync(blankPath)) {
      return json(res, 404, { error: `Document ${id}_BLANK.json not found in ${dir}` });
    }

    const blank = JSON.parse(fs.readFileSync(blankPath, "utf8"));
    const rev1 = fs.existsSync(rev1Path) ? JSON.parse(fs.readFileSync(rev1Path, "utf8")) : null;
    const rev2 = fs.existsSync(rev2Path) ? JSON.parse(fs.readFileSync(rev2Path, "utf8")) : null;
    const reconciliation = fs.existsSync(recPath) ? JSON.parse(fs.readFileSync(recPath, "utf8")) : null;

    return json(res, 200, {
      opaqueId: id,
      holdout,
      type,
      sourceText: blank.sourceText || "",
      blank,
      rev1,
      rev2,
      reconciliation
    });
  }

  // API: Save review (REV1 or REV2)
  if (pathname === "/api/save-review" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const { holdout, type, id, role, reviewerId, facts, highRiskNegatives, notes } = body;

      if (!id || !role || !reviewerId) {
        return json(res, 400, { error: "Missing mandatory fields: id, role, reviewerId" });
      }

      const roleSuffix = role.toUpperCase() === "REV2" ? "REV2" : "REV1";
      const dir = getBaseDir(holdout || "primary", type || "roles");
      const blankPath = path.join(dir, `${id}_BLANK.json`);

      if (!fs.existsSync(blankPath)) {
        return json(res, 404, { error: `Blank template not found for ${id}` });
      }

      const blank = JSON.parse(fs.readFileSync(blankPath, "utf8"));
      const targetFilename = `${id}_${roleSuffix}.json`;
      const targetPath = path.join(dir, targetFilename);

      const reviewDoc: any = {
        schemaVersion: "gate1b-batch06-human-truth/v2",
        holdout: (holdout || "primary").toUpperCase(),
        opaqueId: id,
        documentType: type === "candidates" ? "CANDIDATE_RESUME" : "ROLE_JD",
        title: blank.title || "",
        company: blank.company || "",
        sha256: blank.sha256 || "",
        reviewerId: String(reviewerId).trim(),
        reviewTimestamp: new Date().toISOString(),
        facts: Array.isArray(facts) ? facts : [],
        highRiskNegatives: Array.isArray(highRiskNegatives) ? highRiskNegatives : [],
        adjudicationNotes: notes || ""
      };

      // Validate before saving
      let validationResult: { valid: boolean; errors: string[] };
      if (type === "candidates") {
        validationResult = validateCandidateDocument(reviewDoc, blank.sourceText, targetFilename);
      } else {
        validationResult = validateRoleDocument(reviewDoc, blank.sourceText, targetFilename);
      }

      // Write file
      fs.writeFileSync(targetPath, JSON.stringify(reviewDoc, null, 2), "utf8");

      return json(res, 200, {
        success: true,
        filename: targetFilename,
        valid: validationResult.valid,
        errors: validationResult.errors,
        factCount: reviewDoc.facts.length
      });
    } catch (err: any) {
      return json(res, 500, { error: err.message });
    }
  }

  // API: Save reconciliation
  if (pathname === "/api/save-reconciliation" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const { holdout, type, id, adjudicatorId, facts, highRiskNegatives, notes } = body;

      if (!id || !adjudicatorId) {
        return json(res, 400, { error: "Missing mandatory fields: id, adjudicatorId" });
      }

      const dir = getBaseDir(holdout || "primary", type || "roles");
      const blankPath = path.join(dir, `${id}_BLANK.json`);
      const rev1Path = path.join(dir, `${id}_REV1.json`);
      const rev2Path = path.join(dir, `${id}_REV2.json`);

      if (!fs.existsSync(blankPath)) return json(res, 404, { error: `Blank template not found for ${id}` });
      if (!fs.existsSync(rev1Path)) return json(res, 400, { error: `Missing Reviewer 1 file: ${id}_REV1.json` });
      if (!fs.existsSync(rev2Path)) return json(res, 400, { error: `Missing Reviewer 2 file: ${id}_REV2.json` });

      const blank = JSON.parse(fs.readFileSync(blankPath, "utf8"));
      const rev1Content = fs.readFileSync(rev1Path, "utf8");
      const rev2Content = fs.readFileSync(rev2Path, "utf8");
      const rev1 = JSON.parse(rev1Content);
      const rev2 = JSON.parse(rev2Content);

      const targetFilename = `${id}_RECONCILIATION.json`;
      const targetPath = path.join(dir, targetFilename);

      const recDoc: any = {
        schemaVersion: "gate1b-batch06-human-truth/v2",
        holdout: (holdout || "primary").toUpperCase(),
        opaqueId: id,
        documentType: type === "candidates" ? "CANDIDATE_RESUME" : "ROLE_JD",
        title: blank.title || "",
        company: blank.company || "",
        sha256: blank.sha256 || "",
        reviewer1Id: rev1.reviewerId,
        reviewer2Id: rev2.reviewerId,
        adjudicatorId: String(adjudicatorId).trim(),
        rev1ArtifactHash: sha256(rev1Content),
        rev2ArtifactHash: sha256(rev2Content),
        dualReviewVerified: true,
        facts: Array.isArray(facts) ? facts : [],
        highRiskNegatives: Array.isArray(highRiskNegatives) ? highRiskNegatives : [],
        adjudicationNotes: notes || ""
      };

      // Validate against canonical Gate 1B schema
      let validationResult: { valid: boolean; errors: string[] };
      if (type === "candidates") {
        validationResult = validateCandidateDocument(recDoc, blank.sourceText, targetFilename);
      } else {
        validationResult = validateRoleDocument(recDoc, blank.sourceText, targetFilename);
      }

      fs.writeFileSync(targetPath, JSON.stringify(recDoc, null, 2), "utf8");

      return json(res, 200, {
        success: true,
        filename: targetFilename,
        valid: validationResult.valid,
        errors: validationResult.errors,
        factCount: recDoc.facts.length
      });
    } catch (err: any) {
      return json(res, 500, { error: err.message });
    }
  }

  // 404
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`  RADAR v2 Gate 1B — Human Adjudication Portal`);
  console.log(`================================================================`);
  console.log(`  Reviewer 1 URL : http://localhost:${PORT}/reviewer1`);
  console.log(`  Reviewer 2 URL : http://localhost:${PORT}/reviewer2`);
  console.log(`  Reconciler URL : http://localhost:${PORT}/reconcile`);
  console.log(`----------------------------------------------------------------`);
  console.log(`  Materials Dir  : ${ROOT}`);
  console.log(`================================================================`);
});
