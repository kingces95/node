'use strict';
const common = require('../common');
const assert = require('assert');
const { spawn } = require('child_process');

// Regression test: the parent reclaimer must remain paused while the child
// owns its stdin, or it can steal the bytes before the child reads them.
const childCode = `
  const fs = require('fs');
  const buffer = Buffer.alloc(1);

  process.send('ready');
  process.on('message', () => {
    const count = fs.readSync(0, buffer, 0, 1, null);
    fs.writeSync(
      1,
      Buffer.concat([
        Buffer.from(String(count) + ':'),
        buffer.subarray(0, count),
      ]));
    process.disconnect();
  });
`;

const child = spawn(process.execPath, ['-e', childCode], {
  stdio: ['straw', 'pipe', 'inherit', 'ipc'],
});
let stdout = '';
let reclaimed = '';

child.stdout.setEncoding('utf8');
child.stdout.on('data', (data) => {
  stdout += data;
});

child.on('message', common.mustCall((message) => {
  assert.strictEqual(message, 'ready');
  child.stdin.write('abc', common.mustCall(() => {
    child.send('read', common.mustCall((err) => {
      assert.ifError(err);
    }));
  }));
  child.stdin.end();
}));

child.on('exit', common.mustCall((code, signal) => {
  assert.strictEqual(code, 0);
  assert.strictEqual(signal, null);

  const reclaimer = child.stdin.reclaimer;
  reclaimer.setEncoding('utf8');
  reclaimer.on('data', (data) => {
    reclaimed += data;
  });
  reclaimer.on('end', common.mustCall(() => {
    assert.strictEqual(reclaimed, 'bc');
  }));
  reclaimer.resume();
}));

child.on('close', common.mustCall((code, signal) => {
  assert.strictEqual(code, 0);
  assert.strictEqual(signal, null);
  assert.strictEqual(stdout, '1:a');
  assert.strictEqual(reclaimed, 'bc');
}));
