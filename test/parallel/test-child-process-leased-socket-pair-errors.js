'use strict';
const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const { createSocketPair } = require('node:net');
const { test } = require('node:test');

const wait = `setTimeout(() => {}, 60_000);`;

function destroySocketPair(left, right) {
  left.destroy();
  right.destroy();
}

test('socket pair endpoint cannot be leased as stdin', () => {
  const [left, right] = createSocketPair();

  try {
    assert.throws(() => {
      spawn(process.execPath, ['-e', ''], {
        stdio: [right, 'ignore', 'inherit'],
      });
    }, {
      code: 'ERR_INVALID_ARG_VALUE',
    });
  } finally {
    destroySocketPair(left, right);
  }
});

test('socket pair endpoint cannot be leased as stdout', () => {
  const [left, right] = createSocketPair();

  try {
    assert.throws(() => {
      spawn(process.execPath, ['-e', ''], {
        stdio: ['ignore', right, 'inherit'],
      });
    }, {
      code: 'ERR_INVALID_ARG_VALUE',
    });
  } finally {
    destroySocketPair(left, right);
  }
});

test('socket pair endpoint cannot be leased as stderr', () => {
  const [left, right] = createSocketPair();

  try {
    assert.throws(() => {
      spawn(process.execPath, ['-e', ''], {
        stdio: ['ignore', 'ignore', right],
      });
    }, {
      code: 'ERR_INVALID_ARG_VALUE',
    });
  } finally {
    destroySocketPair(left, right);
  }
});

test('socket pair endpoint cannot be leased by spawnSync', () => {
  const [left, right] = createSocketPair();

  try {
    assert.throws(() => {
      spawnSync(process.execPath, ['-e', ''], {
        stdio: ['ignore', 'ignore', 'inherit', right],
      });
    }, {
      code: 'ERR_INVALID_ARG_VALUE',
    });
  } finally {
    destroySocketPair(left, right);
  }
});

test('socket pair endpoint cannot be leased by two children concurrently',
     () => {
       const [left, right] = createSocketPair();
       const child = spawn(process.execPath, ['-e', wait], {
         stdio: ['ignore', 'ignore', 'inherit', right],
       });

       try {
         assert.throws(() => {
           spawn(process.execPath, ['-e', ''], {
             stdio: ['ignore', 'ignore', 'inherit', right],
           });
         }, {
           code: 'ERR_INVALID_STATE',
         });
       } finally {
         child.kill();
         destroySocketPair(left, right);
       }
     });
