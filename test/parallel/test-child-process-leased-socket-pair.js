'use strict';
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createSocketPair } = require('node:net');
const { test } = require('node:test');

const echoUppercaseOnFd3 = `
  const net = require('node:net');
  const socket = new net.Socket({ fd: 3, readable: true, writable: true });
  socket.once('data', (chunk) => {
    socket.end(chunk.toString().toUpperCase());
  });
`;

async function waitForClose(child) {
  const [code, signal] = await once(child, 'close');
  assert.strictEqual(code, 0);
  assert.strictEqual(signal, null);
}

test('child fd 3 can lease socket pair endpoint as duplex channel',
     async () => {
       const [left, right] = createSocketPair();
       const child = spawn(process.execPath, ['-e', echoUppercaseOnFd3], {
         stdio: ['ignore', 'ignore', 'inherit', right],
       });

       try {
         const data = once(left, 'data');
         left.end('hello');

         assert.strictEqual((await data)[0].toString(), 'HELLO');
         await waitForClose(child);
       } finally {
         left.destroy();
         right.destroy();
       }
     });
