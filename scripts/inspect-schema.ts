import Database from "better-sqlite3";
const db = new Database("radar.sqlite");
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[];
console.log("Tables:", tables.map(t => t.name).join(", "));
const count = db.prepare("SELECT COUNT(*) as n FROM job_snapshots").get() as {n:number};
console.log("Total snapshots:", count.n);
const sample = db.prepare("SELECT title, snippet, detail_text FROM job_snapshots WHERE detail_text IS NOT NULL LIMIT 3").all() as {title:string, snippet:string, detail_text:string}[];
for (const s of sample) {
  console.log("---");
  console.log("Title:", s.title?.slice(0,80));
  console.log("Detail (200):", s.detail_text?.slice(0,200));
}
db.close();
