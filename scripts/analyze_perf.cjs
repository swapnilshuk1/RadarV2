const fs = require('fs');
const path = require('path');

const targetFile = process.argv[2] || 'output/timing-baseline.json';
const raw = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
const suites = (raw.testResults || []).map(tr => {
  const fullPath = tr.name;
  const normalized = fullPath.replace(/\\/g, '/');
  const match = normalized.match(/tests\/(.+)$/);
  const relPath = match ? 'tests/' + match[1] : normalized;
  const parts = relPath.split('/');
  const domain = parts[1] || 'root';
  const durationMs = tr.endTime - tr.startTime;
  const numPassingTests = (tr.assertionResults || []).filter(a => a.status === 'passed').length;
  return { name: path.basename(fullPath), relativePath: relPath, domain, numPassingTests, durationMs };
});

suites.sort((a, b) => b.durationMs - a.durationMs);

console.log('==========================================================================================');
console.log('                         RADAR V4 ACTIVE TEST SUITE TIMING PROFILE                        ');
console.log('==========================================================================================');
console.log('Total Suites:', suites.length);
console.log('Total Tests :', suites.reduce((sum, s) => sum + s.numPassingTests, 0));
const totalMs = suites.reduce((sum, s) => sum + s.durationMs, 0);
console.log('Total Time  :', (totalMs / 1000).toFixed(2) + 's (cumulative thread time)');
console.log('------------------------------------------------------------------------------------------');
console.log('Rank | Suite Path                                                      | Tests | Duration');
console.log('------------------------------------------------------------------------------------------');
suites.forEach((s, idx) => {
  console.log(String(idx + 1).padStart(4) + ' | ' + s.relativePath.padEnd(63) + ' | ' + String(s.numPassingTests).padStart(5) + ' | ' + (s.durationMs / 1000).toFixed(2).padStart(7) + 's');
});

console.log('------------------------------------------------------------------------------------------');
console.log('\nDOMAIN AGGREGATE BREAKDOWN:');
console.log('------------------------------------------------------------------------------------------');
const domainMap = {};
suites.forEach(s => {
  if (!domainMap[s.domain]) domainMap[s.domain] = { suites: 0, tests: 0, durationMs: 0 };
  domainMap[s.domain].suites++;
  domainMap[s.domain].tests += s.numPassingTests;
  domainMap[s.domain].durationMs += s.durationMs;
});
Object.entries(domainMap).sort((a, b) => b[1].durationMs - a[1].durationMs).forEach(([domain, stats]) => {
  console.log(domain.padEnd(15) + ' | Suites: ' + String(stats.suites).padStart(3) + ' | Tests: ' + String(stats.tests).padStart(5) + ' | Time: ' + (stats.durationMs / 1000).toFixed(2).padStart(7) + 's (' + ((stats.durationMs / totalMs) * 100).toFixed(1) + '%)');
});
console.log('==========================================================================================');
