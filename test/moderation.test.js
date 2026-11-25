import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarshnessCheck } from '../server/moderation.js';
import { MODEL } from '../server/cluster.js';

// A stand-in for the Anthropic client: records the request, returns `answer` as the model's JSON.
function stubClient(answer) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (body, options) => {
        calls.push({ body, options });
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] };
      },
    },
  };
}

test('harshness answers map back from per-call numbers', async () => {
  const client = stubClient({
    cards: [
      { card: 1, level: 0, reason: '' },
      { card: 3, level: 2, reason: 'Puts down a whole team' },
      { card: 2, level: 1, reason: 'Edgy:\nworth a look' },
      { card: 9, level: 2, reason: 'No such card' },
    ],
  });
  const check = createHarshnessCheck({ apiKey: 'test', client });
  const result = await check([
    { id: 900_000, text: 'third by id' },
    { id: 5, text: 'first by id' },
    { id: 77, text: 'second by id' },
  ]);

  // Sent as 1..N in id order, never the real ids.
  const [{ body, options }] = client.calls;
  assert.deepEqual(body.messages[0].content.split('\n').map((l) => JSON.parse(l)), [
    { card: 1, text: 'first by id' },
    { card: 2, text: 'second by id' },
    { card: 3, text: 'third by id' },
  ]);
  assert.equal(body.messages[0].content.includes('900000'), false);
  assert.equal(body.model, MODEL);
  assert.equal(body.max_tokens, 6000);
  assert.equal(body.output_config.effort, 'low');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.deepEqual(options, { timeout: 15_000, maxRetries: 0 });

  // Back to real ids; an unknown number is dropped; the reason is one line.
  assert.ok(result instanceof Map);
  assert.deepEqual([...result.keys()].sort((a, b) => a - b), [5, 77, 900_000]);
  assert.deepEqual(result.get(5), { level: 0, reason: '' });
  assert.deepEqual(result.get(77), { level: 1, reason: 'Edgy: worth a look' });
  assert.deepEqual(result.get(900_000), { level: 2, reason: 'Puts down a whole team' });
});

test('without a key there is no harshness check', () => {
  assert.equal(createHarshnessCheck({ apiKey: '' }), null);
});

test('a level outside 0 to 2 leaves that card unchecked; a cut-off answer is a failure', async () => {
  const odd = stubClient({ cards: [{ card: 1, level: 3, reason: 'x' }, { card: 2, level: 1.5, reason: 'y' }] });
  const result = await createHarshnessCheck({ apiKey: 'test', client: odd })([{ id: 1, text: 'a' }, { id: 2, text: 'b' }]);
  assert.equal(result.size, 0);

  const cut = { messages: { create: async () => ({ stop_reason: 'max_tokens', content: [] }) } };
  await assert.rejects(createHarshnessCheck({ apiKey: 'test', client: cut })([{ id: 1, text: 'a' }]));
});
