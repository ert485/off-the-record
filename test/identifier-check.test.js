import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createChecker } from '../public/shared/identifier-check.js';
import { isSingleEmoji, firstEmoji } from '../public/shared/emoji.js';

const list = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').split('\n');
const check = createChecker({ firstNames: list('../public/lists/first-names.txt'), companies: list('../public/lists/companies.txt') });

test('flags first names, companies, handles, emails and phone numbers', () => {
  assert.deepEqual(check("Sarah's demo went great"), ['sarah']);
  assert.deepEqual(check('Leaving Vendasta was hard'), ['vendasta']);
  assert.deepEqual(check('thanks @jdoe'), ['@jdoe']);
  assert.deepEqual(check('mail me a@b.co'), ['a@b.co']);
  assert.deepEqual(check('call 306-555-1234'), ['306-555-1234']);
});

test('does not flag names that are everyday words', () => {
  assert.deepEqual(check('I will mark this year with grace and hope'), []);
  assert.deepEqual(check('A small moment that stuck with me'), []);
});

test('company names match whole words only', () => {
  assert.deepEqual(check('a buzz about nothing'), []);
  assert.deepEqual(check('worked at zu this year'), ['zu']);
});

test('reactions accept exactly one emoji', () => {
  for (const ok of ['🙋', '🫂', '👍🏽', '👩‍💻', '🇨🇦', '❤️']) assert.equal(isSingleEmoji(ok), true, ok);
  for (const bad of ['', 'a', 'ok', '🙋🙋', 'hi 🙋', '1']) assert.equal(isSingleEmoji(bad), false, bad);
  assert.equal(firstEmoji('lol 🦆 duck'), '🦆');
});
