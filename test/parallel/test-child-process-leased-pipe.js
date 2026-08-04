'use strict';
const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { createPipe } = require('node:net');
const { test } = require('node:test');
const { text } = require('node:stream/consumers');

const readOneByteFromStdin = `
  const fs = require('node:fs');
  const buffer = Buffer.alloc(1);
  const count = fs.readSync(0, buffer, 0, 1, null);
  fs.writeSync(1, buffer.subarray(0, count));
`;

const readOneByteFromFd3 = `
  const fs = require('node:fs');
  const buffer = Buffer.alloc(1);
  const count = fs.readSync(3, buffer, 0, 1, null);
  fs.writeSync(1, buffer.subarray(0, count));
`;

const writeStdout = `
  process.stdout.write('hello stdout\\n');
`;

const writeStderr = `
  process.stderr.write('hello stderr\\n');
`;

const writeFd4 = `
  const fs = require('node:fs');
  fs.writeSync(4, 'hello fd4\\n');
`;

const holdOpen = `
  process.send('ready');
  process.on('message', (message) => {
    if (message === 'close') process.exit(0);
  });
`;

const holdStdinOpen = `
  process.stdin.resume();
  process.send('ready');
`;

// Keep these examples in sync with the net.createPipe() examples in
// doc/api/net.md.
const createPipeCjsExample = `
  const { spawn } = require('node:child_process');
  const { createPipe } = require('node:net');
  const { text } = require('node:stream/consumers');

  const { readable, writable } = createPipe();
  const child = spawn(process.execPath, ['-e', \`
    const fs = require('node:fs');
    const buffer = Buffer.alloc(1);
    const count = fs.readSync(0, buffer, 0, 1, null);
    fs.writeSync(1, buffer.subarray(0, count));
  \`], {
    stdio: [readable, 'pipe', 'inherit'],
  });

  writable.end('abc');
  const output = text(child.stdout);

  child.on('close', async () => {
    console.log(await output);
    console.log(await text(readable));
  });
`;

const createPipeMjsExample = `
  import { spawn } from 'node:child_process';
  import { createPipe } from 'node:net';
  import { text } from 'node:stream/consumers';

  const { readable, writable } = createPipe();
  const child = spawn(process.execPath, ['-e', \`
    const fs = require('node:fs');
    const buffer = Buffer.alloc(1);
    const count = fs.readSync(0, buffer, 0, 1, null);
    fs.writeSync(1, buffer.subarray(0, count));
  \`], {
    stdio: [readable, 'pipe', 'inherit'],
  });

  writable.end('abc');
  const output = text(child.stdout);

  child.on('close', async () => {
    console.log(await output);
    console.log(await text(readable));
  });
`;

const tick = () => new Promise((resolve) => setImmediate(resolve));

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
  assert.strictEqual(await output, 'a\nbc\n');
}

function trySpawn(...args) {
  try {
    return { child: spawn(...args) };
  } catch (error) {
    return { error };
  }
}

test('createPipe returns directional OS-backed streams', () => {
  const { readable, writable } = createPipe();

  assert.strictEqual(readable.readable, true);
  assert.strictEqual(readable.writable, false);
  assert.strictEqual(writable.readable, false);
  assert.strictEqual(writable.writable, true);
  assert.notStrictEqual(readable._handle, null);
  assert.notStrictEqual(writable._handle, null);

  readable.destroy();
  writable.destroy();
});

test('net.createPipe documentation examples', async () => {
  await runExample(['-e'], createPipeCjsExample);
  await runExample(['--input-type=module', '-e'], createPipeMjsExample);
});

test('pre-spawn writes finish before readable is borrowed',
     async () => {
       const { readable, writable } = createPipe();

       writable.end('abc');
       const finish = once(writable, 'finish').then(() => true);

       assert.strictEqual(await finish, true);

       const child = spawn(process.execPath, ['-e', readOneByteFromStdin], {
         stdio: [readable, 'pipe', 'inherit'],
       });
       const output = text(child.stdout);

       await waitForClose(child);
       assert.strictEqual(await output, 'a');
       readable.resume();
       assert.strictEqual(await text(readable), 'bc');
     });

test('readable starts paused so the parent does not pre-consume bytes',
     async () => {
       const { readable, writable } = createPipe();

       writable.end('abc');
       await once(writable, 'finish');
       assert.notStrictEqual(readable.readableFlowing, true);

       const child = spawn(process.execPath, ['-e', readOneByteFromStdin], {
         stdio: [readable, 'pipe', 'inherit'],
       });
       const output = text(child.stdout);

       assert.notStrictEqual(readable.readableFlowing, true);
       await waitForClose(child);
       assert.strictEqual(await output, 'a');
       assert.notStrictEqual(readable.readableFlowing, true);
       readable.resume();
       assert.strictEqual(readable.readableFlowing, true);
       assert.strictEqual(await text(readable), 'bc');
     });

test('child stdin borrows readable end and parent reclaims suffix',
     async () => {
       const { readable, writable } = createPipe();

       writable.end('abc');
       await once(writable, 'finish');

       const child = spawn(process.execPath, ['-e', readOneByteFromStdin], {
         stdio: [readable, 'pipe', 'inherit'],
       });
       const output = text(child.stdout);

       await waitForClose(child);
       assert.strictEqual(await output, 'a');
       readable.resume();
       assert.strictEqual(await text(readable), 'bc');
     });

test('child close does not wait on parent-owned readable', async () => {
  const { readable, writable } = createPipe();

  writable.end('abc');
  await once(writable, 'finish');

  const child = spawn(process.execPath, ['-e', readOneByteFromStdin], {
    stdio: [readable, 'ignore', 'inherit'],
  });

  await waitForClose(child);
  assert.strictEqual(readable.destroyed, false);
  readable.resume();
});

test('child stdout borrows writable end and parent reads output', async () => {
  const { readable, writable } = createPipe();
  const child = spawn(process.execPath, ['-e', writeStdout], {
    stdio: ['ignore', writable, 'inherit'],
  });

  writable.destroy();

  assert.strictEqual(await text(readable), 'hello stdout\n');
  readable.resume();
  await waitForClose(child);
});

test('child stderr borrows writable end and parent reads output', async () => {
  const { readable, writable } = createPipe();
  const child = spawn(process.execPath, ['-e', writeStderr], {
    stdio: ['ignore', 'ignore', writable],
  });

  writable.destroy();

  assert.strictEqual(await text(readable), 'hello stderr\n');
  readable.resume();
  await waitForClose(child);
});

test('fd 3 borrows readable end and parent reclaims suffix', async () => {
  const { readable, writable } = createPipe();

  writable.end('abc');
  await once(writable, 'finish');

  const child = spawn(process.execPath, ['-e', readOneByteFromFd3], {
    stdio: ['ignore', 'pipe', 'inherit', readable],
  });
  const output = text(child.stdout);

  await waitForClose(child);
  assert.strictEqual(await output, 'a');
  readable.resume();
  assert.strictEqual(await text(readable), 'bc');
});

test('fd 4 borrows writable end and parent reads output', async () => {
  const { readable, writable } = createPipe();
  const child = spawn(process.execPath, ['-e', writeFd4], {
    stdio: ['ignore', 'ignore', 'inherit', 'ignore', writable],
  });

  writable.destroy();

  assert.strictEqual(await text(readable), 'hello fd4\n');
  readable.resume();
  await waitForClose(child);
});

test('readable cannot be borrowed by two children concurrently', async () => {
  const { readable, writable } = createPipe();
  const child = spawn(process.execPath, ['-e', holdStdinOpen], {
    stdio: [readable, 'ignore', 'inherit', 'ipc'],
  });
  await once(child, 'message');

  const result = trySpawn(process.execPath, ['-e', holdStdinOpen], {
    stdio: [readable, 'ignore', 'inherit', 'ipc'],
  });

  const childClose = once(child, 'close');
  const resultClose = result.child != null ? once(result.child, 'close') : null;
  if (result.child != null)
    result.child.kill();

  writable.end();
  await childClose;
  if (resultClose != null)
    await resultClose;

  assert.strictEqual(result.error?.code, 'ERR_INVALID_STATE');
});

test('writable cannot be borrowed by two children concurrently', async () => {
  const { readable, writable } = createPipe();
  const child = spawn(process.execPath, ['-e', holdOpen], {
    stdio: ['ignore', writable, 'inherit', 'ipc'],
  });
  await once(child, 'message');

  const result = trySpawn(process.execPath, ['-e', holdOpen], {
    stdio: ['ignore', writable, 'inherit', 'ipc'],
  });

  const childClose = once(child, 'close');
  const resultClose = result.child != null ? once(result.child, 'close') : null;
  if (result.child != null)
    result.child.kill();

  child.send('close');
  writable.destroy();
  readable.resume();
  await childClose;
  if (resultClose != null)
    await resultClose;

  assert.strictEqual(result.error?.code, 'ERR_INVALID_STATE');
});

test('child close does not make parent readable flow before reuse',
     async () => {
       const { readable, writable } = createPipe();
       let flowed = '';
       readable.on('data', (chunk) => {
         flowed += chunk;
       });
       readable.pause();

       writable.end('abc');
       await once(writable, 'finish');

       const childA = spawn(process.execPath, ['-e', readOneByteFromStdin], {
         stdio: [readable, 'pipe', 'inherit'],
       });
       const outputA = text(childA.stdout);

       await waitForClose(childA);
       assert.strictEqual(await outputA, 'a');
       await tick();

       assert.strictEqual(flowed, '');
       assert.strictEqual(readable.readableFlowing, false);

       const childB = spawn(process.execPath, ['-e', readOneByteFromStdin], {
         stdio: [readable, 'pipe', 'inherit'],
       });
       const outputB = text(childB.stdout);

       await waitForClose(childB);
       assert.strictEqual(await outputB, 'b');
       readable.resume();
       assert.strictEqual(await text(readable), 'c');
     });

test('owned pipe pipeline requires parent endpoint cleanup', async () => {
  {
    const { readable, writable } = createPipe();
    const producer = spawn(process.execPath, [
      '-e',
      "process.stdout.write('abc')",
    ], {
      stdio: ['ignore', writable, 'inherit'],
    });
    const consumer = spawn(process.execPath, [
      '-e',
      "process.stdin.pipe(process.stdout)",
    ], {
      stdio: [readable, 'pipe', 'inherit'],
    });
    const output = text(consumer.stdout);
    const producerClose = waitForClose(producer);
    const consumerClose = waitForClose(consumer);

    // The producer borrowed only the write fd, so its close does not wait for
    // the parent-owned writable endpoint to close.
    await producerClose;
    // Unlike Node-created stdio pipes above, the parent still owns a writable
    // endpoint. Close the parent copy so the consumer can observe EOF.
    writable.destroy();
    await consumerClose;
    // The parent owns the consumer stdout pipe, so consumer close does not
    // wait for the parent reader to close and the output remains available.
    assert.strictEqual(await output, 'abc');
    readable.resume();
  }

  {
    const { readable, writable } = createPipe();

    writable.end('abc');
    await once(writable, 'finish');

    const childA = spawn(process.execPath, ['-e', readOneByteFromStdin], {
      stdio: [readable, 'pipe', 'inherit'],
    });
    const outputA = text(childA.stdout);

    await waitForClose(childA);
    assert.strictEqual(await outputA, 'a');

    const childB = spawn(process.execPath, ['-e', readOneByteFromStdin], {
      stdio: [readable, 'pipe', 'inherit'],
    });
    const outputB = text(childB.stdout);

    await waitForClose(childB);
    assert.strictEqual(await outputB, 'b');
    // Explicit ownership lets the parent reuse the same pipe after child A,
    // after child B, and finally reclaim the unread suffix.
    readable.resume();
    assert.strictEqual(await text(readable), 'c');
  }
});

test('parent destroys readable without closing child borrowed reader',
     async () => {
       const { readable, writable } = createPipe();

       writable.end('a');
       await once(writable, 'finish');

       const child = spawn(process.execPath, ['-e', readOneByteFromStdin], {
         stdio: [readable, 'pipe', 'inherit'],
       });
       const output = text(child.stdout);

       readable.destroy();

       await waitForClose(child);
       assert.strictEqual(await output, 'a');
     });

test('parent destroys writable without closing child borrowed writer',
     async () => {
       const { readable, writable } = createPipe();
       const child = spawn(process.execPath, ['-e', writeStdout], {
         stdio: ['ignore', writable, 'inherit'],
       });

       writable.destroy();

       assert.strictEqual(await text(readable), 'hello stdout\n');
       await waitForClose(child);
     });

test('all write handles closed produces EOF after buffered bytes', async () => {
  const { readable, writable } = createPipe();

  writable.end('abc');

  assert.strictEqual(await text(readable), 'abc');
});

test('spawn failure leaves caller-owned endpoints usable', async () => {
  const { readable, writable } = createPipe();
  const child = spawn('program-that-had-better-not-exist', [], {
    stdio: [readable, 'ignore', 'ignore'],
  });

  const close = new Promise((resolve) => child.on('close', resolve));
  const [[err]] = await Promise.all([
    once(child, 'error'),
    close,
  ]);
  assert.strictEqual(err.code, 'ENOENT');
  assert.strictEqual(readable.destroyed, false);
  assert.strictEqual(writable.destroyed, false);

  writable.end('abc');
  assert.strictEqual(await text(readable), 'abc');
});

test('spawnSync rejects parent-owned pipe streams', () => {
  const { readable, writable } = createPipe();

  assert.throws(() => {
    spawnSync(process.execPath, ['-e', ''], {
      stdio: [readable, 'ignore', 'ignore'],
    });
  }, {
    code: 'ERR_INVALID_ARG_VALUE',
    message: /parent-owned pipe streams are only supported by spawn\(\)/,
  });

  readable.destroy();
  writable.destroy();
});

test('writable endpoint is rejected as child stdin', () => {
  const { readable, writable } = createPipe();

  assert.throws(() => {
    spawn(process.execPath, ['-e', ''], {
      stdio: [writable, 'ignore', 'ignore'],
    });
  }, {
    code: 'ERR_INVALID_ARG_VALUE',
  });

  readable.destroy();
  writable.destroy();
});

test('readable endpoint is rejected as child stdout', () => {
  const { readable, writable } = createPipe();

  assert.throws(() => {
    spawn(process.execPath, ['-e', ''], {
      stdio: ['ignore', readable, 'ignore'],
    });
  }, {
    code: 'ERR_INVALID_ARG_VALUE',
  });

  readable.destroy();
  writable.destroy();
});

test('readable endpoint is rejected as child stderr', () => {
  const { readable, writable } = createPipe();

  assert.throws(() => {
    spawn(process.execPath, ['-e', ''], {
      stdio: ['ignore', 'ignore', readable],
    });
  }, {
    code: 'ERR_INVALID_ARG_VALUE',
  });

  readable.destroy();
  writable.destroy();
});
