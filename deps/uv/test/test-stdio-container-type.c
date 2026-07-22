/* Copyright Joyent, Inc. and other Node contributors. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

#include "uv.h"
#include "../src/uv-common.h"
#include "task.h"

#ifdef _WIN32
# include <io.h>
# include <windows.h>
#else
# include <errno.h>
# include <fcntl.h>
# include <stdio.h>
# include <string.h>
# include <unistd.h>
#endif


static int open_tty(void) {
#ifdef _WIN32
  HANDLE handle;

  handle = CreateFileA("conin$",
                       GENERIC_READ | GENERIC_WRITE,
                       FILE_SHARE_READ | FILE_SHARE_WRITE,
                       NULL,
                       OPEN_EXISTING,
                       FILE_ATTRIBUTE_NORMAL,
                       NULL);
  if (handle == INVALID_HANDLE_VALUE)
    return -1;

  return _open_osfhandle((intptr_t) handle, 0);
#else
  int fd;

  fd = open("/dev/tty", O_RDONLY, 0);
  if (fd < 0) {
    fprintf(stderr, "Cannot open /dev/tty as read-only: %s\n", strerror(errno));
    fflush(stderr);
  }

  return fd;
#endif
}


TEST_IMPL(stdio_container_type) {
  uv_loop_t* loop;
  uv_stdio_container_t stdio;
  uv_tcp_t tcp;
  uv_tty_t tty;
  uv_pipe_t pipe;
  uv_pipe_t ipc;
  uv_pipe_t straw;
  uv_pipe_t reclaimer;
  int tty_fd;

  loop = uv_default_loop();

  ASSERT_EQ((UV_IGNORE | UV_CREATE_PIPE | UV_INHERIT_FD | UV_INHERIT_STREAM),
            UV_STDIO_CONTAINER_MODE_MASK);

  /* Ignored stdio has no payload and therefore no stream or pipe. */
  stdio.flags = UV_IGNORE;
  ASSERT_EQ(UV_IGNORE, UV_STDIO_CONTAINER_GET_MODE(&stdio));
  ASSERT(UV_STDIO_CONTAINER_IS_WELL_FORMED(&stdio));
  ASSERT(UV_STDIO_CONTAINER_TYPE_IS_NONE(&stdio));

  /* Numeric descriptors are fd payloads, not stream payloads. */
  stdio.flags = UV_INHERIT_FD;
  stdio.data.fd = 2;
  ASSERT_EQ(UV_INHERIT_FD, UV_STDIO_CONTAINER_GET_MODE(&stdio));
  ASSERT(UV_STDIO_CONTAINER_IS_WELL_FORMED(&stdio));
  ASSERT(UV_STDIO_CONTAINER_TYPE_IS_FD(&stdio));

  /* Stream modes require a stream payload before type macros are queried. */
  stdio.flags = UV_INHERIT_STREAM;
  stdio.data.stream = NULL;
  ASSERT(!UV_STDIO_CONTAINER_IS_WELL_FORMED(&stdio));
  stdio.flags = UV_CREATE_PIPE;
  stdio.data.stream = NULL;
  ASSERT(!UV_STDIO_CONTAINER_IS_WELL_FORMED(&stdio));

  /* Inherited streams report the concrete uv stream type. */
  ASSERT_OK(uv_tcp_init(loop, &tcp));
  stdio.flags = UV_INHERIT_STREAM;
  stdio.data.stream = (uv_stream_t*) &tcp;
  ASSERT_EQ(UV_INHERIT_STREAM, UV_STDIO_CONTAINER_GET_MODE(&stdio));
  ASSERT(UV_STDIO_CONTAINER_IS_WELL_FORMED(&stdio));
  ASSERT(UV_STDIO_CONTAINER_TYPE_IS_STREAM_TCP(&stdio));

  /* TTY coverage is conditional because many test hosts have no terminal. */
  tty_fd = open_tty();
  if (tty_fd >= 0) {
    ASSERT_EQ(UV_TTY, uv_guess_handle(tty_fd));
    ASSERT_OK(uv_tty_init(loop, &tty, tty_fd, 1));
    stdio.flags = UV_INHERIT_STREAM;
    stdio.data.stream = (uv_stream_t*) &tty;
    ASSERT(UV_STDIO_CONTAINER_IS_WELL_FORMED(&stdio));
    ASSERT(UV_STDIO_CONTAINER_TYPE_IS_STREAM_TTY(&stdio));
    uv_close((uv_handle_t*) &tty, NULL);
  }

  /* A standard pipe remains a standard pipe when inherited. */
  ASSERT_OK(uv_pipe_init2(loop, &pipe, UV_PIPE_STANDARD));
  stdio.flags = UV_INHERIT_STREAM;
  stdio.data.stream = (uv_stream_t*) &pipe;
  ASSERT(UV_STDIO_CONTAINER_IS_WELL_FORMED(&stdio));
  ASSERT(UV_STDIO_CONTAINER_TYPE_IS_STREAM_PIPE(&stdio));

  /* Created stdio pipes use the same type query surface. */
  stdio.flags = UV_CREATE_PIPE;
  stdio.data.stream = (uv_stream_t*) &pipe;
  ASSERT_EQ(UV_CREATE_PIPE, UV_STDIO_CONTAINER_GET_MODE(&stdio));
  ASSERT(UV_STDIO_CONTAINER_IS_WELL_FORMED(&stdio));
  ASSERT(UV_STDIO_CONTAINER_TYPE_IS_STREAM_PIPE(&stdio));

  /* Created IPC pipes preserve their IPC pipe type. */
  ASSERT_OK(uv_pipe_init2(loop, &ipc, UV_PIPE_IPC));
  stdio.flags = UV_CREATE_PIPE;
  stdio.data.stream = (uv_stream_t*) &ipc;
  ASSERT_EQ(UV_CREATE_PIPE, UV_STDIO_CONTAINER_GET_MODE(&stdio));
  ASSERT(UV_STDIO_CONTAINER_IS_WELL_FORMED(&stdio));
  ASSERT(UV_STDIO_CONTAINER_TYPE_IS_STREAM_PIPE_IPC(&stdio));

  /* Created straw pipes preserve their straw pipe type. */
  ASSERT_OK(uv_pipe_init2(loop, &straw, UV_PIPE_STRAW));
  ASSERT_OK(uv_pipe_init(loop, &reclaimer, 0));
  stdio.flags = UV_CREATE_PIPE;
  stdio.data.stream = (uv_stream_t*) &straw;
  stdio.data_out.straw.stream = (uv_stream_t*) &reclaimer;
  ASSERT_EQ(UV_CREATE_PIPE, UV_STDIO_CONTAINER_GET_MODE(&stdio));
  ASSERT(UV_STDIO_CONTAINER_IS_WELL_FORMED(&stdio));
  ASSERT(UV_STDIO_CONTAINER_TYPE_IS_STREAM_PIPE_STRAW(&stdio));

  uv_close((uv_handle_t*) &tcp, NULL);
  uv_close((uv_handle_t*) &pipe, NULL);
  uv_close((uv_handle_t*) &ipc, NULL);
  uv_close((uv_handle_t*) &straw, NULL);
  uv_close((uv_handle_t*) &reclaimer, NULL);

  ASSERT_OK(uv_run(loop, UV_RUN_DEFAULT));

  MAKE_VALGRIND_HAPPY(loop);
  return 0;
}
