'use strict';
const common = require('../common');
const assert = require('assert');
const { spawn } = require('child_process');

const childCode = `
  const fs = require('fs');
  const buffer = Buffer.alloc(1);
  const count = fs.readSync(0, buffer, 0, 1, null);
  fs.writeSync(
    1,
    Buffer.concat([
      Buffer.from(String(count) + ':'),
      buffer.subarray(0, count),
    ]));
`;

const childFd3Code = `
  const fs = require('fs');
  const buffer = Buffer.alloc(1);
  const count = fs.readSync(3, buffer, 0, 1, null);
  fs.writeSync(
    1,
    Buffer.concat([
      Buffer.from(String(count) + ':'),
      buffer.subarray(0, count),
    ]));
`;

function spawnStraw() {
  const child = spawn(process.execPath, ['-e', childCode], {
    stdio: ['straw', 'pipe', 'pipe'],
  });

  child.stdin.end('abc');
  return child;
}

// Reclaimer follows the ChildProcess stdio field convention: it is a plain own
// data property rather than an accessor.
{
  const child = spawnStraw();
  const reclaimer = child.stdin.reclaimer;
  const descriptor = Object.getOwnPropertyDescriptor(child.stdin, 'reclaimer');

  assert.deepStrictEqual(descriptor, {
    configurable: true,
    enumerable: true,
    value: reclaimer,
    writable: true,
  });

  child.on('close', common.mustCall((code, signal) => {
    assert.strictEqual(code, 0);
    assert.strictEqual(signal, null);
    assert.strictEqual(reclaimer.destroyed, true);
  }));
}

// If reclaimer is not consumed during the exit turn, flushStdio() drains and
// discards the unread suffix so that 'close' can fire.
{
  const child = spawnStraw();
  let exited = false;
  let reclaimer;
  let reclaimerEnded = false;
  let stdout = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (data) => {
    stdout += data;
  });

  child.on('exit', common.mustCall((code, signal) => {
    exited = true;
    assert.strictEqual(code, 0);
    assert.strictEqual(signal, null);

    reclaimer = child.stdin.reclaimer;
    // Merely observing 'end' does not put the stream into flowing mode. This
    // test deliberately does not consume reclaimer or call reclaimer.resume().
    reclaimer.on('end', common.mustCall(() => {
      reclaimerEnded = true;
    }));
  }));

  child.on('close', common.mustCall((code, signal) => {
    assert.strictEqual(exited, true);
    assert.strictEqual(reclaimerEnded, true);
    assert.strictEqual(reclaimer.readableLength, 0);
    assert.strictEqual(reclaimer.destroyed, true);
    assert.strictEqual(stdout, '1:a');
    assert.strictEqual(code, 0);
    assert.strictEqual(signal, null);
  }));
}

// The 'exit' turn is the client's last chance to consume the unread suffix
// before flushStdio() resumes an otherwise untouched reclaimer on nextTick.
{
  const child = spawnStraw();
  let closed = false;
  let reclaimed = '';

  child.on('exit', common.mustCall(() => {
    const reclaimer = child.stdin.reclaimer;

    reclaimer.setEncoding('utf8');
    reclaimer.on('data', (data) => {
      reclaimed += data;
    });
    reclaimer.on('end', common.mustCall(() => {
      assert.strictEqual(closed, false);
      assert.strictEqual(reclaimed, 'bc');
    }));
    reclaimer.resume();
  }));

  child.on('close', common.mustCall((code, signal) => {
    closed = true;
    assert.strictEqual(reclaimed, 'bc');
    assert.strictEqual(code, 0);
    assert.strictEqual(signal, null);
  }));
}

// Straw is child-input policy rather than stdin-only policy. Descriptors above
// stderr can also consume a prefix and expose their unread suffix for reclaim.
{
  const child = spawn(process.execPath, ['-e', childFd3Code], {
    stdio: ['ignore', 'pipe', 'inherit', 'straw'],
  });
  const straw = child.stdio[3];
  let output = '';
  let reclaimed = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (data) => {
    output += data;
  });
  straw.end('abc');

  child.on('exit', common.mustCall((code, signal) => {
    assert.strictEqual(code, 0);
    assert.strictEqual(signal, null);

    straw.reclaimer.setEncoding('utf8');
    straw.reclaimer.on('data', (data) => {
      reclaimed += data;
    });
    straw.reclaimer.resume();
  }));

  child.on('close', common.mustCall((code, signal) => {
    assert.strictEqual(code, 0);
    assert.strictEqual(signal, null);
    assert.strictEqual(output, '1:a');
    assert.strictEqual(reclaimed, 'bc');
  }));
}

// Destroying the reclaimer while the child is alive explicitly abandons
// recovery without closing the child's independently duplicated descriptor.
{
  const child = spawnStraw();
  const reclaimer = child.stdin.reclaimer;
  let output = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (data) => {
    output += data;
  });
  reclaimer.destroy();

  child.on('close', common.mustCall((code, signal) => {
    assert.strictEqual(code, 0);
    assert.strictEqual(signal, null);
    assert.strictEqual(output, '1:a');
    assert.strictEqual(reclaimer.destroyed, true);
  }));
}

// Once 'close' has fired, automatic discard is complete and reclaimer exposes
// the same already-destroyed stream rather than a buffered copy of the suffix.
{
  const child = spawnStraw();

  child.on('close', common.mustCall((code, signal) => {
    assert.strictEqual(code, 0);
    assert.strictEqual(signal, null);
    assert.strictEqual(child.stdin.reclaimer.destroyed, true);
  }));
}

// A straw stream cannot be reused as another child's stdio.
{
  const child = spawnStraw();

  assert.throws(() => {
    spawn(process.execPath, ['-e', ''], {
      stdio: [child.stdin, 'ignore', 'ignore'],
    });
  }, {
    code: 'ERR_INVALID_ARG_VALUE',
  });

  // The reclaimer is the coupled child-side endpoint and cannot be reused as
  // another child's stdio either.
  assert.throws(() => {
    spawn(process.execPath, ['-e', ''], {
      stdio: [child.stdin.reclaimer, 'ignore', 'ignore'],
    });
  }, {
    code: 'ERR_INVALID_ARG_VALUE',
  });

  child.on('close', common.mustCall((code, signal) => {
    assert.strictEqual(code, 0);
    assert.strictEqual(signal, null);
  }));
}

// ChildProcess 'close' means all owned stdio has closed, including reclaimer.
{
  const child = spawnStraw();
  let closed = false;

  child.on('exit', common.mustCall(() => {
    const reclaimer = child.stdin.reclaimer;
    assert.strictEqual(child.stdin.reclaimer, reclaimer);

    setImmediate(common.mustCall(() => {
      assert.strictEqual(closed, false);
      reclaimer.destroy();
    }));
  }));

  child.on('close', common.mustCall((code, signal) => {
    closed = true;
    assert.strictEqual(code, 0);
    assert.strictEqual(signal, null);
  }));
}

// If exec fails after stdio setup, reclaimer still exists and ends empty.
{
  const child = spawn('program-that-had-better-not-exist', [], {
    stdio: ['straw', 'ignore', 'ignore'],
  });
  let reclaimed = '';

  child.on('error', common.mustCall((err) => {
    assert.strictEqual(err.code, 'ENOENT');

    const reclaimer = child.stdin.reclaimer;
    reclaimer.setEncoding('utf8');
    reclaimer.on('data', (data) => {
      reclaimed += data;
    });
    reclaimer.on('end', common.mustCall(() => {
      assert.strictEqual(reclaimed, '');
    }));
    reclaimer.resume();
  }));

  child.on('close', common.mustCall(() => {
    assert.strictEqual(reclaimed, '');
  }));
}
