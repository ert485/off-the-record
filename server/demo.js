// The scripted demo shown on the projector before Join: prepared content from
// a data file. Nothing here prints demo text; errors and logs are fixed labels.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isSingleEmoji, PRESETS } from '../public/shared/emoji.js';

export const DEMO_STEPS = ['notes', 'pick', 'group', 'react', 'reveal'];
// How long each step shows while the demo plays on a loop (about a minute in
// all; step 2, the pick step, includes the send animation).
export const DEMO_STEP_MS = [10_000, 14_000, 12_000, 14_000, 14_000];
// Shown before the event when the demo file has no teaser of its own.
export const DEFAULT_TEASER = { title: 'Off the Record', lines: ['Starting soon.'] };

const fail = (reason) => {
  throw new Error(reason);
};
const isText = (s, max, min = 1) => typeof s === 'string' && s.trim().length >= min && s.length <= max;

export function validateDemo(obj) {
  if (!obj || typeof obj !== 'object') fail('Demo must be an object');
  const { notes, theme, react, reveal, teaser } = obj;
  if (!Array.isArray(notes) || notes.length < 1 || notes.length > 5) fail('Demo needs 1 to 5 notes');
  if (!notes.every((n) => n && isText(n.text, 200))) fail('Demo notes are 1 to 200 characters');
  if (notes.filter((n) => n.share === true).length !== 1) fail('Demo needs exactly one shared note');
  if (!theme || !isText(theme.name, 60)) fail('Demo theme name is 1 to 60 characters');
  if (typeof theme.haiku !== 'string' || theme.haiku.length > 120) fail('Demo haiku is up to 120 characters');
  if (!react || typeof react !== 'object') fail('Demo needs reactions');
  const presets = PRESETS.map((p) => p.e);
  if (!Array.isArray(react.presets) || !react.presets.every((e) => presets.includes(e))) fail('Demo presets must come from the preset list');
  if (!isSingleEmoji(react.own)) fail('Demo own reaction must be one emoji');
  if (typeof react.comment !== 'string' || react.comment.length > 200) fail('Demo comment is up to 200 characters');
  if (!reveal || typeof reveal !== 'object') fail('Demo needs a reveal');
  if (!Array.isArray(reveal.mix) || !reveal.mix.every((m) => Array.isArray(m) && m.length === 2 && isSingleEmoji(m[0]) && Number.isInteger(m[1]) && m[1] > 0)) {
    fail('Demo mix is pairs of an emoji and a positive whole number');
  }
  if (!Array.isArray(reveal.comments) || reveal.comments.length > 5 || !reveal.comments.every((c) => typeof c === 'string' && c.length <= 200)) {
    fail('Demo comments are up to 5, each up to 200 characters');
  }
  if (teaser !== undefined) {
    if (!teaser || typeof teaser !== 'object') fail('Demo teaser must be an object');
    if (!isText(teaser.title, 60)) fail('Demo teaser title is 1 to 60 characters');
    if (!Array.isArray(teaser.lines) || teaser.lines.length > 4 || !teaser.lines.every((l) => isText(l, 160))) {
      fail('Demo teaser has up to 4 lines of 1 to 160 characters');
    }
  }
  return {
    teaser: teaser ? { title: teaser.title, lines: [...teaser.lines] } : { ...DEFAULT_TEASER, lines: [...DEFAULT_TEASER.lines] },
    notes: notes.map((n) => ({ text: n.text, ...(n.share === true ? { share: true } : {}) })),
    theme: { name: theme.name, haiku: theme.haiku },
    react: { presets: [...react.presets], own: react.own, comment: react.comment },
    reveal: { mix: reveal.mix.map(([e, n]) => [e, n]), comments: [...reveal.comments] },
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
