import { test } from 'node:test';
import assert from 'node:assert/strict';
import { themeCount, groupingPrompt, localClusterer } from '../server/cluster.js';

test('theme count is about one per 12 cards, 2 to 5', () => {
  assert.equal(themeCount(1), 2);
  assert.equal(themeCount(15), 2);
  assert.equal(themeCount(30), 3);
  assert.equal(themeCount(60), 5);
  assert.equal(themeCount(200), 5);
});

test('the grouping prompt asks for about N themes and no catch-all', () => {
  const p = groupingPrompt(60);
  assert.ok(p.includes('about 5 themes'));
  assert.ok(p.includes('No catch-all'));
});

test('the haiku image comes from the cards, not a season or place the prompt suggests', () => {
  const p = groupingPrompt(1);
  assert.ok(!/winter/i.test(p), 'no season in the example images');
  assert.ok(!/prairie/i.test(p));
  assert.ok(p.includes("Don't borrow a specific detail from any single card"));
  assert.ok(p.includes('the world the theme\'s cards actually describe, not from a setting they never mention'));
  assert.ok(p.includes("Never add a season, weather, temperature, or place stereotype the cards don't mention"));
});

test('the local fallback has no haiku', async () => {
  const { themes, local } = await localClusterer([{ id: 1, text: 'x' }]);
  assert.equal(local, true);
  assert.equal(themes[0].haiku, '');
});
