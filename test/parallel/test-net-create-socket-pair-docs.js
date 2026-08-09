'use strict';
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { test } = require('node:test');
const { text } = require('node:stream/consumers');

// Keep these examples in sync with the net.createSocketPair() examples in
// doc/api/net.md.
const createSocketPairCjsExample = `
  const { createSocketPair } = require('node:net');
  const { text } = require('node:stream/consumers');

  (async function() {
    const [left, right] = createSocketPair();

    const leftOutput = text(left);
    const rightOutput = text(right);

    left.end('hello right');
    right.end('hello left');

    console.log(await leftOutput); // Prints: hello left
    console.log(await rightOutput); // Prints: hello right
  })();
`;

const createSocketPairMjsExample = `
  import { createSocketPair } from 'node:net';
  import { text } from 'node:stream/consumers';

  const [left, right] = createSocketPair();

  const leftOutput = text(left);
  const rightOutput = text(right);

  left.end('hello right');
  right.end('hello left');

  console.log(await leftOutput); // Prints: hello left
  console.log(await rightOutput); // Prints: hello right
`;

async function waitForClose(child) {
  const [code, signal] = await once(child, 'close');
  assert.strictEqual(code, 0);
  assert.strictEqual(signal, null);
}

async function runExample(args, code) {
  const child = spawn(process.execPath, [...args, code], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const output = text(child.stdout);

  await waitForClose(child);
  assert.strictEqual(await output, 'hello left\nhello right\n');
}

test('net.createSocketPair documentation examples', async () => {
  await runExample(['-e'], createSocketPairCjsExample);
  await runExample(['--input-type=module', '-e'], createSocketPairMjsExample);
});
