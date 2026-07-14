// Standalone diff viewer. Zero framework dependency.
//   npm run eval:viewer  →  http://localhost:4321
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.cwd(), "data", "golden");
const CASES_DIR = path.join(ROOT, "cases");
const LATEST = path.join(ROOT, "reports", "latest.json");
const PORT = Number(process.env.EVAL_VIEWER_PORT || 4321);

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function notFound(res: http.ServerResponse) {
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";

  if (url === "/" || url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(path.join(__dirname, "index.html"), "utf-8"));
    return;
  }

  if (url === "/api/report/latest") {
    if (!fs.existsSync(LATEST)) return json(res, 404, { error: "no report; run: npm run eval" });
    return json(res, 200, JSON.parse(fs.readFileSync(LATEST, "utf-8")));
  }

  const caseMatch = url.match(/^\/api\/case\/([a-z0-9-]+)$/);
  if (caseMatch) {
    const id = caseMatch[1];
    const dir = path.join(CASES_DIR, id);
    if (!fs.existsSync(dir)) return notFound(res);
    return json(res, 200, {
      id,
      jd: fs.readFileSync(path.join(dir, "jd.txt"), "utf-8"),
      snapshot: JSON.parse(fs.readFileSync(path.join(dir, "snapshot.json"), "utf-8")),
      expected: JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf-8")),
    });
  }

  notFound(res);
});

server.listen(PORT, () => {
  console.log(`Extraction QA viewer → http://localhost:${PORT}`);
  console.log(`Serving reports from ${ROOT}`);
});
