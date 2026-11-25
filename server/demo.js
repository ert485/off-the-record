// The scripted demo shown on the projector before Join: prepared content from
// a data file. Nothing here prints demo text; errors and logs are fixed labels.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isSingleEmoji, PRESETS } from '../public/shared/emoji.js';

export const DEMO_STEPS = ['notes', 'pick', 'group', 'react', 'reveal'];
// How long each step shows while the demo plays on a loop (about 70 seconds in
// all): the notes being written, the pick with its send animation, and the
// grouping get the most time.
export const DEMO_STEP_MS = [13_000, 16_000, 16_000, 12_000, 12_000];
// Shown before the event when the demo file has no teaser of its own.
export const DEFAULT_TEASER = { title: 'Off the Record', lines: ['Starting soon.'] };

const fail = (reason) => {
  throw new Error(reason);
};
const isText = (s, max, min = 1) => typeof s === 'string' && s.trim().length >= min && s.length <= max;

export function validateDemo(obj) {
  if (!obj || typeof obj !== 'object') fail('Demo must be an object');
  const { notes, theme, react, reveal, teaser, credits } = obj;
  if (!Array.isArray(notes) || notes.length < 1 || notes.length > 5) fail('Demo needs 1 to 5 notes');
  if (!notes.every((n) => n && isText(n.text, 200))) fail('Demo notes are 1 to 200 characters');
  const shared = notes.filter((n) => n.share === true).length;
  if (shared < 1 || shared > 3) fail('Demo needs 1 to 3 shared notes');
  if (!theme || !isText(theme.name, 60)) fail('Demo theme name is 1 to 60 characters');
  if (typeof theme.haiku !== 'string' || theme.haiku.length > 120) fail('Demo haiku is up to 120 characters');
  if (!react || typeof react !== 'object') fail('Demo needs reactions');
  const presets = PRESETS.map((p) => p.e);
  if (!Array.isArray(react.presets) || !react.presets.every((e) => presets.includes(e))) fail('Demo presets must come from the preset list');
  if (!isSingleEmoji(react.own)) fail('Demo own reaction must be one emoji');
  if (!reveal || typeof reveal !== 'object') fail('Demo needs a reveal');
  if (!Array.isArray(reveal.mix) || !reveal.mix.every((m) => Array.isArray(m) && m.length === 2 && isSingleEmoji(m[0]) && Number.isInteger(m[1]) && m[1] > 0)) {
    fail('Demo mix is pairs of an emoji and a positive whole number');
  }
  if (teaser !== undefined) {
    if (!teaser || typeof teaser !== 'object') fail('Demo teaser must be an object');
    if (!isText(teaser.title, 60)) fail('Demo teaser title is 1 to 60 characters');
    if (!Array.isArray(teaser.lines) || teaser.lines.length > 4 || !teaser.lines.every((l) => isText(l, 160))) {
      fail('Demo teaser has up to 4 lines of 1 to 160 characters');
    }
  }
  if (credits !== undefined) {
    if (!credits || typeof credits !== 'object') fail('Demo credits must be an object');
    if (!isText(credits.title, 60)) fail('Demo credits title is 1 to 60 characters');
    if (!Array.isArray(credits.lines) || credits.lines.length > 12 || !credits.lines.every((l) => isText(l, 80))) {
      fail('Demo credits have up to 12 lines of 1 to 80 characters');
    }
  }
  return {
    // Optional, and public text shown on the projector at the closing only.
    ...(credits ? { credits: { title: credits.title, lines: [...credits.lines] } } : {}),
    teaser: teaser ? { title: teaser.title, lines: [...teaser.lines] } : { ...DEFAULT_TEASER, lines: [...DEFAULT_TEASER.lines] },
    notes: notes.map((n) => ({ text: n.text, ...(n.share === true ? { share: true } : {}) })),
    theme: { name: theme.name, haiku: theme.haiku },
    // An older file's react.comment and reveal.comments are dropped: the demo shows no comments.
    react: { presets: [...react.presets], own: react.own },
    reveal: { mix: reveal.mix.map(([e, n]) => [e, n]) },
  };
}

function readDemo(path) {
  return validateDemo(JSON.parse(readFileSync(path, 'utf8')));
}

// local.json (the facilitator's own) if valid, else the example. A missing or
// invalid example throws, so a bad deploy fails at startup.
export function loadDemo(dir) {
  const local = join(dir, 'local.json');
  if (existsSync(local)) {
    try {
      return readDemo(local);
    } catch {
      console.log('demo: local file invalid, using the example');
    }
  }
  return readDemo(join(dir, 'example.json'));
}
