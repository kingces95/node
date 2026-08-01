# Straw Stdio Reclaim Flow

This note documents the current straw stdio spike for review and later
orientation. It is intentionally local to the test while the feature is still
experimental.

## Goal

`stdio: 'straw'` creates a child stdin pipe that can be reclaimed after the
child exits. If the child reads only part of its stdin, `child.stdin.reclaimer`
is a readable stream for the bytes still buffered in the child-side pipe.

The useful contract is symmetric with existing Node spawn behavior:

- if spawn succeeds, the parent gets normal stdio streams;
- if exec fails after stdio setup, the parent still gets initialized stdio
  streams;
- for straw, the reclaimer is also a stream in both cases;
- the client closes streams through normal stream/handle lifecycle.

## Layers

Client JavaScript passes:

```js
spawn(cmd, args, {
  stdio: ['straw', 'pipe', 'pipe'],
});
```

`lib/internal/child_process.js` translates this into a C++-readable stdio
descriptor:

```js
{
  type: 'pipe',
  readable: false,
  writable: false,
  handle: new Pipe(PipeConstants.STRAW),
  reclaimer: new Pipe(PipeConstants.SOCKET),
}
```

The `handle` pipe is the normal parent-side stdin stream. The `reclaimer` pipe
is an unconnected caller-owned pipe handle that libuv opens in place.

`src/process_wrap.cc` maps the descriptor into `uv_stdio_container_t`:

```c
container.flags = UV_CREATE_PIPE | UV_READABLE_PIPE;
container.data.stream = handle->stream();
container.data_out.straw.stream = reclaimer->stream();
```

`deps/uv` creates the OS pipe pair for the child stdio slot, duplicates the
child-side endpoint, and opens the duplicate into
`container.data_out.straw.stream`.

## File Descriptor Flow

On Unix, `uv__process_init_stdio()` creates a pipe/socket pair:

```text
fds[0] = parent-side endpoint
fds[1] = child-side endpoint
```

For a straw pipe, libuv duplicates `fds[1]`:

```text
reclaim_fd = dup_cloexec(fds[1])
```

Then libuv opens the caller-provided reclaimer stream:

```c
uv_pipe_open((uv_pipe_t*) container->data_out.straw.stream, reclaim_fd);
```

After that succeeds, the reclaimer stream owns `reclaim_fd`. If it fails, libuv
closes `reclaim_fd` immediately and returns the error.

The normal stdio stream is opened later by `uv__process_open_stream()`:

```text
close fds[1] in the parent
move fds[0] into container.data.stream
```

This follows the existing libuv rule: raw fds are temporary setup state, and
opened `uv_pipe_t` handles own their fds afterward.

On Windows, `uv__stdio_create()` creates the child stdio pipe pair, duplicates
the child handle as non-inheritable, converts it to a CRT fd, then opens the
caller-provided reclaimer pipe with `uv_pipe_open()`.

## Node Stream Flow

After `uv_spawn()`, Node creates the normal stdio socket:

```js
stream.socket = createSocket(stream.handle, readable);
```

For straw descriptors, Node marks that socket as a straw and creates a readable
socket over the already-open reclaimer handle. It exposes that socket as the
`reclaimer` property:

```js
const reclaimer = child.stdin.reclaimer;
```

`reclaimer` follows the existing ChildProcess stdio field convention. It is an
own data property with `writable`, `enumerable`, and `configurable` all set to
`true`; it is not an accessor. As with the existing writable ChildProcess stdio
fields, replacing or deleting it can interfere with automatic lifecycle work.

The child process `'close'` event waits for the reclaimer stream to close. If the
client attaches listeners, it can observe the leftover bytes. If not,
`flushStdio()` resumes the stream during the post-exit close path and drains the
bytes to EOF, matching the ordinary untouched stdio behavior. Accessing
`reclaimer` after the process has already emitted `'close'` returns the same
stream in its already-closed state.

## Failure Behavior

libuv intentionally preserves initialized stdio streams for Node when exec
fails with runtime errors such as `ENOENT`. That behavior is documented in
`deps/uv/src/unix/process.c` near the disabled `goto error` path.

Straw follows the same rule. If stdio setup succeeded but exec failed, the
normal straw stream and the reclaimer stream still exist. Reclaiming in the
`'error'` path yields an empty readable stream.

If setup fails before the reclaimer stream is opened, libuv closes any raw
duplicate endpoint it created and returns the setup error.

## Tests

The libuv tests cover:

- pipe subtype initialization;
- stdio container type predicates;
- reclaiming unread bytes from fd 0;
- reclaiming unread bytes from fd greater than 2;
- repeated spawn setup failures without unbounded handle growth.

The Node test covers:

- validation failure closes both handles allocated for an earlier straw;
- `reclaimer` has the documented plain-field descriptor;
- an ignored reclaimer is drained and discarded so that `'close'` can fire;
- reclaiming in `'exit'` yields the unread suffix;
- a straw on child fd 3 also yields its unread suffix;
- the reclaimer remains paused while the child owns its input;
- destroying the reclaimer early abandons recovery without disrupting the child;
- reclaiming after `'close'` returns the already-closed reclaimer stream;
- neither a straw stream nor its reclaimer can be reused as another child
  process stdio input;
- the reclaimer stream delays child `'close'`;
- spawn failure still exposes an empty reclaimer stream.
