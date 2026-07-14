import fs from "fs";
import path from "path";
import http from "http";

const DATASET_PATH = path.join(process.cwd(), "src/data/benchmark/dataset-v1-draft.json");

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    return res.end();
  }

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>RADAR Golden Benchmark Review</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; display: flex; height: 100vh; overflow: hidden; background: #1e1e1e; color: #ddd; }
    .split { width: 50%; height: 100%; overflow: auto; padding: 20px; box-sizing: border-box; }
    #left { border-right: 1px solid #444; background: #fff; color: #000; }
    #right { display: flex; flex-direction: column; }
    textarea { width: 100%; flex-grow: 1; font-family: monospace; font-size: 13px; background: #2d2d2d; color: #eee; border: 1px solid #555; padding: 10px; resize: none; margin-bottom: 10px; }
    .controls { display: flex; gap: 10px; align-items: center; justify-content: space-between; padding-bottom: 10px; }
    button { padding: 8px 16px; background: #0066cc; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #0055aa; }
    #status { color: #888; font-size: 14px; }
  </style>
</head>
<body>
  <div id="left" class="split">
    <div id="html-content">Loading...</div>
  </div>
  <div id="right" class="split">
    <div class="controls">
      <div>
        <button id="prevBtn">Previous</button>
        <span id="counter">0 / 0</span>
        <button id="nextBtn">Next</button>
      </div>
      <div>
        <span id="status"></span>
        <button id="saveBtn">Save & Next</button>
      </div>
    </div>
    <div style="margin-bottom: 10px;">
      <label>Difficulty: <select id="diffSelect"><option>Easy</option><option>Medium</option><option>Hard</option></select></label>
      <label style="margin-left:20px;"><input type="checkbox" id="negCheck"> Negative Example</label>
    </div>
    <textarea id="json-editor"></textarea>
  </div>

  <script>
    let dataset = { entries: [] };
    let currentIndex = 0;

    async function load() {
      const res = await fetch("/api/data");
      dataset = await res.json();
      render();
    }

    function render() {
      if (!dataset.entries.length) return;
      const entry = dataset.entries[currentIndex];
      
      document.getElementById('html-content').innerHTML = 
        '<h2>' + entry.metadata.originalTitle + ' @ ' + entry.metadata.originalCompany + '</h2>' +
        '<div><a href="' + entry.metadata.url + '" target="_blank">View Original</a></div><hr/>' +
        '<pre style="white-space:pre-wrap; font-family:sans-serif;">' + entry.rawText + '</pre>';
      
      const editable = {
        truth: entry.truth,
        expectedRecommendation: entry.expectedRecommendation
      };
      document.getElementById('json-editor').value = JSON.stringify(editable, null, 2);
      
      document.getElementById('counter').innerText = (currentIndex + 1) + " / " + dataset.entries.length;
      document.getElementById('diffSelect').value = entry.difficulty;
      document.getElementById('negCheck').checked = !!entry.isNegativeExample;
      document.getElementById('status').innerText = "";
    }

    async function save() {
      try {
        const parsed = JSON.parse(document.getElementById('json-editor').value);
        const entry = dataset.entries[currentIndex];
        entry.truth = parsed.truth;
        entry.expectedRecommendation = parsed.expectedRecommendation;
        entry.difficulty = document.getElementById('diffSelect').value;
        entry.isNegativeExample = document.getElementById('negCheck').checked;
        
        document.getElementById('status').innerText = "Saving...";
        
        const res = await fetch("/api/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dataset)
        });
        
        if (res.ok) {
          if (currentIndex < dataset.entries.length - 1) {
            currentIndex++;
            render();
          } else {
            document.getElementById('status').innerText = "All done! Saved.";
          }
        } else {
          document.getElementById('status').innerText = "Error saving!";
        }
      } catch (e) {
        alert("Invalid JSON! Please fix errors before saving.\\n" + e.message);
      }
    }

    document.getElementById('prevBtn').onclick = () => { if(currentIndex > 0) { currentIndex--; render(); } };
    document.getElementById('nextBtn').onclick = () => { if(currentIndex < dataset.entries.length-1) { currentIndex++; render(); } };
    document.getElementById('saveBtn').onclick = save;

    load();
  </script>
</body>
</html>
    `);
  }

  if (req.method === "GET" && req.url === "/api/data") {
    if (!fs.existsSync(DATASET_PATH)) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: "File not found" }));
    }
    const data = fs.readFileSync(DATASET_PATH, "utf-8");
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(data);
  }

  if (req.method === "POST" && req.url === "/api/save") {
    let body = "";
    req.on("data", chunk => body += chunk.toString());
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        fs.writeFileSync(DATASET_PATH, JSON.stringify(parsed, null, 2));
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
  }
});

const PORT = 3050;
server.listen(PORT, () => {
  console.log("\\n\\n🚀 QA Review UI running at: http://localhost:" + PORT);
  console.log("Dataset mapped to: " + DATASET_PATH + "\\n");
});
