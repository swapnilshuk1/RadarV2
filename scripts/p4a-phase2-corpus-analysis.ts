/**
 * P4-A Phase 2: Full Corpus Distribution Analysis
 * 
 * Analyze score distribution across all 1,514 opportunities
 */

import { runEngine, invalidateEngineCache } from "../src/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";

interface ScoreStatistics {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  stdDev: number;
  percentile25: number;
  percentile75: number;
  percentile90: number;
  percentile95: number;
  percentile99: number;
}

interface DistributionBand {
  range: string;
  count: number;
  percentage: number;
  decisions: {
    PURSUE: number;
    CONSIDER: number;
    PASS: number;
  };
}

function calculateStats(values: number[]): ScoreStatistics {
  const sorted = [...values].sort((a, b) => a - b);
  const count = values.length;
  const min = sorted[0];
  const max = sorted[count - 1];
  const mean = values.reduce((a, b) => a + b, 0) / count;
  
  const median = count % 2 === 0 
    ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
    : sorted[Math.floor(count / 2)];
  
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / count;
  const stdDev = Math.sqrt(variance);
  
  const percentile = (p: number) => {
    const index = Math.ceil((p / 100) * count) - 1;
    return sorted[Math.max(0, Math.min(index, count - 1))];
  };
  
  return {
    count,
    min,
    max,
    mean,
    median,
    stdDev,
    percentile25: percentile(25),
    percentile75: percentile(75),
    percentile90: percentile(90),
    percentile95: percentile(95),
    percentile99: percentile(99),
  };
}

function analyzeCorpus() {
  console.log("=== P4-A Phase 2: Full Corpus Distribution Analysis ===\n");
  
  invalidateEngineCache();
  
  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);
  
  const { records } = runEngine(projection, 0);
  
  console.log(`Total records: ${records.length}\n`);
  
  // Filter out vetoed records for score analysis
  const scoredRecords = records.filter(r => r.priority !== null && r.priority !== undefined);
  const vetoedRecords = records.filter(r => r.vetoed);
  
  console.log(`Scored records: ${scoredRecords.length}`);
  console.log(`Vetoed records: ${vetoedRecords.length}`);
  console.log(`\n`);
  
  const scores = scoredRecords.map(r => r.priority!);
  
  // Overall Statistics
  const stats = calculateStats(scores);
  
  console.log("=== OVERALL SCORE STATISTICS ===\n");
  console.log(`Count:        ${stats.count}`);
  console.log(`Min:          ${stats.min}`);
  console.log(`Max:          ${stats.max}`);
  console.log(`Mean:         ${stats.mean.toFixed(2)}`);
  console.log(`Median:       ${stats.median}`);
  console.log(`Std Dev:      ${stats.stdDev.toFixed(2)}`);
  console.log(`25th %ile:    ${stats.percentile25}`);
  console.log(`75th %ile:    ${stats.percentile75}`);
  console.log(`90th %ile:    ${stats.percentile90}`);
  console.log(`95th %ile:    ${stats.percentile95}`);
  console.log(`99th %ile:    ${stats.percentile99}`);
  console.log(`\n`);
  
  // Distribution by bands
  const bands: DistributionBand[] = [];
  for (let start = 0; start < 100; start += 10) {
    const end = start + 9;
    const bandRecords = scoredRecords.filter(r => {
      const s = r.priority!;
      return s >= start && s <= end;
    });
    
    const decisions = {
      PURSUE: bandRecords.filter(r => r.verb === "PURSUE").length,
      CONSIDER: bandRecords.filter(r => r.verb === "CONSIDER").length,
      PASS: bandRecords.filter(r => r.verb === "PASS").length,
    };
    
    bands.push({
      range: `${start}-${end}`,
      count: bandRecords.length,
      percentage: (bandRecords.length / scoredRecords.length) * 100,
      decisions,
    });
  }
  
  console.log("=== SCORE DISTRIBUTION BY BANDS ===\n");
  console.log("Band       | Count | %     | PURSUE | CONSIDER | PASS");
  console.log("-----------|-------|-------|--------|----------|------");
  for (const band of bands) {
    console.log(
      `${band.range.padEnd(10)} | ${String(band.count).padStart(5)} | ${band.percentage.toFixed(1).padStart(5)} | ${String(band.decisions.PURSUE).padStart(6)} | ${String(band.decisions.CONSIDER).padStart(8)} | ${String(band.decisions.PASS).padStart(4)}`
    );
  }
  console.log(`\n`);
  
  // Decision distribution
  const pursueRecords = scoredRecords.filter(r => r.verb === "PURSUE");
  const considerRecords = scoredRecords.filter(r => r.verb === "CONSIDER");
  const passRecords = scoredRecords.filter(r => r.verb === "PASS");
  
  console.log("=== DECISION DISTRIBUTION ===\n");
  console.log(`PURSUE:   ${pursueRecords.length} (${((pursueRecords.length / scoredRecords.length) * 100).toFixed(1)}%)`);
  console.log(`CONSIDER: ${considerRecords.length} (${((considerRecords.length / scoredRecords.length) * 100).toFixed(1)}%)`);
  console.log(`PASS:     ${passRecords.length} (${((passRecords.length / scoredRecords.length) * 100).toFixed(1)}%)`);
  console.log(`\n`);
  
  // Score statistics by decision
  if (pursueRecords.length > 0) {
    const pursueScores = pursueRecords.map(r => r.priority!);
    const pursueStats = calculateStats(pursueScores);
    console.log("=== PURSUE SCORES ===");
    console.log(`  Mean: ${pursueStats.mean.toFixed(2)}`);
    console.log(`  Range: ${pursueStats.min} - ${pursueStats.max}`);
    console.log(`  Median: ${pursueStats.median}`);
  }
  
  if (considerRecords.length > 0) {
    const considerScores = considerRecords.map(r => r.priority!);
    const considerStats = calculateStats(considerScores);
    console.log("\n=== CONSIDER SCORES ===");
    console.log(`  Mean: ${considerStats.mean.toFixed(2)}`);
    console.log(`  Range: ${considerStats.min} - ${considerStats.max}`);
    console.log(`  Median: ${considerStats.median}`);
  }
  
  if (passRecords.length > 0) {
    const passScores = passRecords.map(r => r.priority!);
    const passStats = calculateStats(passScores);
    console.log("\n=== PASS SCORES ===");
    console.log(`  Mean: ${passStats.mean.toFixed(2)}`);
    console.log(`  Range: ${passStats.min} - ${passStats.max}`);
    console.log(`  Median: ${passStats.median}`);
  }
  console.log(`\n`);
  
  // Identify suspicious patterns
  console.log("=== SUSPICIOUS PATTERNS ===\n");
  
  // Check for score compression
  const uniqueScores = new Set(scores).size;
  const compressionRatio = uniqueScores / scores.length;
  console.log(`Unique scores: ${uniqueScores} / ${scores.length} (${(compressionRatio * 100).toFixed(1)}% unique)`);
  
  if (compressionRatio < 0.5) {
    console.log(`⚠️ WARNING: High score compression (${(compressionRatio * 100).toFixed(1)}% unique)`);
  }
  
  // Check for dense clusters
  const scoreCounts: Record<number, number> = {};
  for (const s of scores) {
    scoreCounts[s] = (scoreCounts[s] || 0) + 1;
  }
  
  const topDuplicated = Object.entries(scoreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  console.log(`\nMost common scores:`);
  for (const [score, count] of topDuplicated) {
    console.log(`  Score ${score}: ${count} opportunities`);
  }
  
  // Check for gaps
  const sortedUnique = [...new Set(scores)].sort((a, b) => a - b);
  let maxGap = 0;
  let gapAt = 0;
  for (let i = 1; i < sortedUnique.length; i++) {
    const gap = sortedUnique[i] - sortedUnique[i - 1];
    if (gap > maxGap) {
      maxGap = gap;
      gapAt = sortedUnique[i - 1];
    }
  }
  
  console.log(`\nLargest gap: ${maxGap} points (between ${gapAt} and ${gapAt + maxGap})`);
  if (maxGap > 5) {
    console.log(`⚠️ WARNING: Large score gap detected`);
  }
  
  // Check utilization of 0-100 scale
  const usedRange = stats.max - stats.min;
  const utilization = usedRange / 100;
  console.log(`\nScale utilization: ${usedRange}/100 (${(utilization * 100).toFixed(1)}%)`);
  
  if (utilization < 0.5) {
    console.log(`⚠️ WARNING: Low scale utilization (${(utilization * 100).toFixed(1)}%)`);
    console.log(`  Consider whether 0-100 is the right scale`);
  }
  
  // Check for plateaus
  console.log(`\n=== SCORE PLATEAUS ===`);
  let currentPlateau = 1;
  let maxPlateau = 1;
  for (let i = 1; i < sortedUnique.length; i++) {
    if (sortedUnique[i] === sortedUnique[i - 1] + 1) {
      currentPlateau++;
      maxPlateau = Math.max(maxPlateau, currentPlateau);
    } else {
      currentPlateau = 1;
    }
  }
  console.log(`Longest consecutive sequence: ${maxPlateau} scores`);
  
  // Final summary
  console.log(`\n=== PHASE 2 SUMMARY ===\n`);
  console.log(`✓ Corpus analyzed: ${records.length} opportunities`);
  console.log(`✓ Score range: ${stats.min} - ${stats.max}`);
  console.log(`✓ Mean/Median: ${stats.mean.toFixed(2)} / ${stats.median}`);
  console.log(`✓ Std Dev: ${stats.stdDev.toFixed(2)}`);
  console.log(`✓ Unique scores: ${uniqueScores} (${(compressionRatio * 100).toFixed(1)}%)`);
  console.log(`✓ Scale utilization: ${(utilization * 100).toFixed(1)}%`);
  console.log(`\nDecision distribution:`);
  console.log(`  PURSUE: ${pursueRecords.length} (${((pursueRecords.length / scoredRecords.length) * 100).toFixed(1)}%)`);
  console.log(`  CONSIDER: ${considerRecords.length} (${((considerRecords.length / scoredRecords.length) * 100).toFixed(1)}%)`);
  console.log(`  PASS: ${passRecords.length} (${((passRecords.length / scoredRecords.length) * 100).toFixed(1)}%)`);
  
  // Save detailed results for next phases
  return {
    records,
    scoredRecords,
    stats,
    bands,
    pursueRecords,
    considerRecords,
    passRecords,
  };
}

const results = analyzeCorpus();

// Export for next phases
export { results };
