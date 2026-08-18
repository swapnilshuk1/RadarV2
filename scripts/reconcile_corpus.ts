import { runEngine } from "../src/lib/intelligence/engine";
import { candidateProfile } from "../src/data/candidate-profile";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";

async function reconcileCorpus() {
  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);
  const { records } = runEngine(projection);

  console.log(`Total records returned by runEngine: ${records.length}`);

  const verbCounts: Record<string, number> = {};
  const verbRecords: Record<string, any[]> = {};

  for (const r of records) {
    const verb = r.verb || "UNDEFINED_VERB";
    verbCounts[verb] = (verbCounts[verb] || 0) + 1;
    if (!verbRecords[verb]) verbRecords[verb] = [];
    verbRecords[verb].push(r);
  }

  console.log("\nRaw Verb Counts across all records:");
  console.log(JSON.stringify(verbCounts, null, 2));

  // Check if any record has verb NOT in ["PURSUE", "CONSIDER", "PASS", "SPARSE_SPEC"]
  const knownVerbs = ["PURSUE", "CONSIDER", "PASS", "SPARSE_SPEC"];
  const unknownRecords = records.filter(r => !knownVerbs.includes(r.verb));

  if (unknownRecords.length > 0) {
    console.log(`\nFound ${unknownRecords.length} record(s) with unexpected verb:`);
    for (const u of unknownRecords) {
      console.log(`JobHash: ${u.jobHash}, Verb: "${u.verb}", QualityScore: ${u.qualityScore}, Vetoed: ${u.vetoed}, VetoReason: ${u.vetoReason}`);
    }
  } else {
    console.log("\nAll records have known verbs. Checking why sum was 1513 instead of 1514...");
  }

  // Double-check total count vs sum of counts
  let sum = 0;
  for (const [v, c] of Object.entries(verbCounts)) {
    sum += c;
    console.log(`  ${v}: ${c}`);
  }
  console.log(`Sum of verb counts: ${sum}`);
}

reconcileCorpus().catch(console.error);
