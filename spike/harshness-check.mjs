// Spike: does the harshness check (server/moderation.js, unchanged) flag the
// cards a facilitator would want to look at, and pass the rest, in a few
// seconds? 20 invented cards: two put-downs, one that is cute but cruel, and
// 17 that should pass, including frustrated, sad and sweary ones (hard
// feelings are welcome; put-downs aren't).
//
//   ANTHROPIC_API_KEY=... node spike/harshness-check.mjs [runs=3]
//
// Expected: the three marked cards get level 1 or more, the rest 0. Only the
// invented cards below are sent. Record the timing in the spec ("Harshness
// check and the hold" under Facilitation logic).
import { createHarshnessCheck } from '../server/moderation.js';

const runs = Number(process.argv[2] ?? 3);

// flag: true for the cards that should come back at level 1 or more.
const CARDS = [
  { text: 'Got laid off in March. Found something better in June, but the spring was rough.', flag: false },
  { text: 'Our standups went from 15 minutes to 45. Nobody knows how to stop it.', flag: false },
  { text: 'The new hires on the platform team are useless. Honestly, they should all be fired.', flag: true },
  { text: 'I finally took a real vacation and didn’t check Slack once.', flag: false },
  { text: 'Spent three weeks on a migration that got cancelled the day it shipped. Still mad.', flag: false },
  { text: 'People who still write PHP are just too dumb to learn a real language.', flag: true },
  { text: 'My daughter learned to ride a bike. Best thing that happened all year.', flag: false },
  { text: 'Burnout hit hard in the fall. I’m better now, but it took a while.', flag: false },
  { text: 'AI writes half my code now and I’m not sure how I feel about it.', flag: false },
  { text: 'Bless our new manager’s heart, they try so hard to sound technical. It’s adorable, like a toddler in a tie.', flag: true },
  { text: 'Moved to a four-day week. Same output, way happier team.', flag: false },
  { text: 'The office reopened and I realised how much I missed the people, not the commute.', flag: false },
  { text: 'Prod went down on my birthday. Of course it did.', flag: false },
  { text: 'Started mentoring two juniors. Teaching made me better at my own job.', flag: false },
  { text: 'This year was a dumpster fire and I’m tired.', flag: false },
  { text: 'Switched from backend to design. Scariest and best decision.', flag: false },
  { text: 'Lost a friend this year. Work felt very small after that.', flag: false },
  { text: 'Every vendor pitch now has the word agentic in it. Make it stop.', flag: false },
  { text: 'Went to my first meetup in years and actually talked to people.', flag: false },
  { text: 'Our on-call rota finally got fixed after two years of asking.', flag: false },
];

const check = createHarshnessCheck({ apiKey: process.env.ANTHROPIC_API_KEY });
if (!check) {
  console.error('Set ANTHROPIC_API_KEY to run this spike.');
  process.exit(1);
}

// Random-looking ids, as real cards have, so the numbering is exercised.
const items = CARDS.map((c, i) => ({ id: 1_000_003 * (i + 7) % 2_147_483_647, text: c.text, flag: c.flag }));
const NAMES = ['fine', 'edgy', 'harsh'];
const timings = [];
let misses = 0;

for (let run = 1; run <= runs; run++) {
  const started = performance.now();
  const answers = await check(items.map(({ id, text }) => ({ id, text })));
  const ms = Math.round(performance.now() - started);
  timings.push(ms);
  console.log(`\nRun ${run}: ${ms} ms, ${answers.size} of ${items.length} answered`);
  for (const item of items) {
    const a = answers.get(item.id);
    const level = a?.level;
    const ok = level === undefined ? false : item.flag ? level >= 1 : level === 0;
    if (!ok) misses += 1;
    const mark = ok ? '  ' : '✗ ';
    const verdict = level === undefined ? 'not answered' : `${level} ${NAMES[level]}`;
    console.log(`${mark}${verdict.padEnd(12)} ${item.text.slice(0, 60)}${a?.reason ? `  (${a.reason})` : ''}`);
  }
}

timings.sort((a, b) => a - b);
console.log(`\nTiming over ${runs} runs: min ${timings[0]} ms, median ${timings[Math.floor(timings.length / 2)]} ms, max ${timings.at(-1)} ms`);
console.log(misses ? `${misses} answers differ from the expected levels (marked ✗).` : 'Every answer matched the expected levels.');
