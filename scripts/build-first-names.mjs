// Builds public/lists/first-names.txt for the on-phone identifier check.
//
// Input: the SSA-derived baby-names CSV (public domain) from
// https://github.com/hadley/data-baby-names (columns: year,name,percent,sex).
// Usage: node scripts/build-first-names.mjs path/to/baby-names.csv [count]
//
// Keeps the most common names for people born 1950 onward (the room's age
// range), then drops any name that is also an everyday lowercase English word
// in /usr/share/dict/words ("will", "mark", "grace", "rose"), so the check
// doesn't flag ordinary sentences.
import { readFileSync, writeFileSync } from 'node:fs';

const [csvPath, countArg] = process.argv.slice(2);
const count = Number(countArg ?? 3000);
const totals = new Map();
for (const line of readFileSync(csvPath, 'utf8').split('\n').slice(1)) {
  const [year, name, percent] = line.split(',').map((s) => s.replaceAll('"', ''));
  if (!name || Number(year) < 1950) continue;
  const key = name.toLowerCase();
  totals.set(key, (totals.get(key) ?? 0) + Number(percent));
}
const words = new Set(
  readFileSync('/usr/share/dict/words', 'utf8').split('\n').filter((w) => w && w === w.toLowerCase()),
);
const extra = readFileSync(new URL('./first-names-extra.txt', import.meta.url), 'utf8')
  .split('\n').map((s) => s.trim().toLowerCase()).filter((s) => s && !s.startsWith('#'));
const top = [...totals].sort((a, b) => b[1] - a[1]).slice(0, count).map(([n]) => n);
const names = [...new Set([...top, ...extra])].filter((n) => n.length > 1 && !words.has(n)).sort();
writeFileSync(new URL('../public/lists/first-names.txt', import.meta.url), names.join('\n') + '\n');
console.log(`${names.length} names written`);
