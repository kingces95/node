'use strict';
const common = require('../common');
const assert = require('assert');
const { once } = require('events');
const { existsSync } = require('fs');
const { spawn } = require('child_process');
const tmpdir = require('../common/tmpdir');

const sleepArray = new Int32Array(new SharedArrayBuffer(4));

// This regression test demonstrates that pipelines established in Node can and
// must be created in the same tick. The parent must give the producer stream to
// the consumer in that tick; wrapping it has the side effect of pausing the
// stream, which prevents the parent from draining bytes intended for the
// consumer from the OS pipe buffer. If the handoff is delayed, the parent may
// consume those bytes before the consumer receives the stream.

const producerCode = `
  const fs = require('fs');
  const marker = process.argv[1];

  if (marker) {
    fs.writeSync(1, 'abc');
    fs.writeFileSync(marker, '');
  }
  process.send('ready');
  process.on('message', (message) => {
    if (message === 'write') {
      fs.writeSync(1, 'abc');
      process.send('wrote');
    } else if (message === 'close') {
      fs.closeSync(1);
      process.send('closed', () => process.disconnect());
    }
  });
`;

const consumerCode = `
  const fs = require('fs');
  const buffer = Buffer.alloc(3);

  process.send('ready');
  process.on('message', (message) => {
    if (message === 'read') {
      const count = fs.readSync(0, buffer, 0, buffer.length, null);
      fs.writeSync(1, String(count) + ':' + buffer.subarray(0, count));
      process.disconnect();
    }
  });
`;

function spawnProducer(marker = '') {
  return spawn(process.execPath, ['-e', producerCode, marker], {
    stdio: ['ignore', 'pipe', 'inherit', 'ipc'],
  });
}

function spawnConsumer(input) {
  return spawn(process.execPath, ['-e', consumerCode], {
    stdio: [input, 'pipe', 'inherit', 'ipc'],
  });
}

function waitForMessage(child, expected) {
  return once(child, 'message').then(([message]) => {
    assert.strictEqual(message, expected);
  });
}

function send(child, message) {
  return new Promise((resolve, reject) => {
    child.send(message, (err) => err ? reject(err) : resolve());
  });
}

function collectOutput(child) {
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (data) => { output += data; });
  return once(child, 'close').then(([code, signal]) => {
    assert.strictEqual(code, 0);
    assert.strictEqual(signal, null);
    return output;
  });
}

async function closeProducer(producer) {
  const closedMessage = waitForMessage(producer, 'closed');
  const exited = once(producer, 'exit');
  const closed = once(producer, 'close');
  await send(producer, 'close');
  await closedMessage;
  const [code, signal] = await exited;
  assert.strictEqual(code, 0);
  assert.strictEqual(signal, null);
  producer.stdout.destroy();
  await closed;
}

async function testSynchronousHandoff() {
  tmpdir.refresh();
  const marker = tmpdir.resolve('producer-wrote');
  const producer = spawnProducer(marker);
  const producerReady = waitForMessage(producer, 'ready');

  // Wait synchronously until the producer has written. The read is armed, but
  // libuv cannot fetch the bytes until the parent returns to the event loop.
  const deadline = Date.now() + common.platformTimeout(10_000);
  while (!existsSync(marker)) {
    assert(Date.now() < deadline, 'producer did not write before handoff');
    Atomics.wait(sleepArray, 0, 0, 1);
  }

  // Wrap in the same turn. readStop() disarms the parent's read while the bytes
  // are still in the kernel pipe buffer.
  const consumer = spawnConsumer(producer.stdout);
  const consumerReady = waitForMessage(consumer, 'ready');
  const output = collectOutput(consumer);

  await Promise.all([producerReady, consumerReady]);
  await send(consumer, 'read');

  assert.strictEqual(await output, '3:abc');
  assert.strictEqual(producer.stdout.readableLength, 0);
  await closeProducer(producer);
}

async function testDelayedHandoff() {
  const producer = spawnProducer();
  await waitForMessage(producer, 'ready');

  const readable = once(producer.stdout, 'readable');
  const wrote = waitForMessage(producer, 'wrote');
  await send(producer, 'write');
  await Promise.all([wrote, readable]);
  assert.strictEqual(producer.stdout.readableLength, 3);

  // Wrapping after the readable event stops future native reads, but the bytes
  // already fetched by the parent remain in its JavaScript stream buffer.
  const consumer = spawnConsumer(producer.stdout);
  const output = collectOutput(consumer);
  await waitForMessage(consumer, 'ready');

  const producerClosedMessage = waitForMessage(producer, 'closed');
  const producerExited = once(producer, 'exit');
  const producerClosed = once(producer, 'close');
  await send(producer, 'close');
  await producerClosedMessage;
  await send(consumer, 'read');

  assert.strictEqual(await output, '0:');
  assert.strictEqual(producer.stdout.read().toString(), 'abc');
  const [code, signal] = await producerExited;
  assert.strictEqual(code, 0);
  assert.strictEqual(signal, null);
  producer.stdout.destroy();
  await producerClosed;
}

Promise.resolve()
  .then(testSynchronousHandoff)
  .then(testDelayedHandoff)
  .then(common.mustCall());
