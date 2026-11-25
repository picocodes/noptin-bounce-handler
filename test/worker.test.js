import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

const env = { NOPTIN_BOUNCE_URL: 'https://example.com/wp-json/noptin/v1/bounce_handler/cloudflare/test' };
const hard = { type: 'cf.email.sending.message.bounced', payload: { bounce: { type: 'hard' } } };
const complaint = { type: 'cf.email.sending.message.complained' };
const soft = { type: hard.type, payload: { bounce: { type: 'soft' } } };
function message(body) {
  return { body, acked: false, retried: null, ack() { this.acked = true; }, retry(options) { this.retried = options; } };
}

test('forwards hard bounces and complaints, ignores soft bounces and other events', async (t) => {
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, env.NOPTIN_BOUNCE_URL);
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    sent.push(JSON.parse(options.body));
    return Response.json(true);
  });
  const messages = [message(JSON.stringify(hard)), message(complaint), message(soft), message({ type: 'other' })];
  await worker.queue({ messages }, env);
  assert.deepEqual(sent, [hard, complaint]);
  assert.ok(messages.every(m => m.acked && !m.retried));
});

test('retries failed messages individually after 300 seconds', async (t) => {
  const outcomes = [Response.json(false), new Response('', {status: 503}), new Response('invalid'), new Error('network'), Response.json(true)];
  t.mock.method(globalThis, 'fetch', async () => {
    const result = outcomes.shift();
    if (result instanceof Error) throw result;
    return result;
  });
  const messages = Array.from({length: 5}, () => message(hard));
  await worker.queue({ messages }, env);
  for (const m of messages.slice(0, 4)) {
    assert.equal(m.acked, false);
    assert.deepEqual(m.retried, { delaySeconds: 300 });
  }
  assert.equal(messages[4].acked, true);
});

test('invalid JSON and missing or insecure secret are retried', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('Unexpected fetch'); });
  for (const [body, bindings] of [['invalid', env], [hard, {}], [hard, { NOPTIN_BOUNCE_URL: 'http://example.com' }]]) {
    const m = message(body);
    await worker.queue({ messages: [m] }, bindings);
    assert.equal(m.acked, false);
    assert.deepEqual(m.retried, { delaySeconds: 300 });
  }
});
