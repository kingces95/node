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


TEST_IMPL(pipe_init2) {
  uv_loop_t* loop;
  uv_pipe_t standard;
  uv_pipe_t ipc;
  uv_pipe_t straw;
  uv_pipe_t invalid;

  loop = uv_default_loop();

  /* Standard pipes are plain byte streams with no type behavior. */
  ASSERT_OK(uv_pipe_init2(loop, &standard, UV_PIPE_STANDARD));
  ASSERT_EQ(UV_PIPE_STANDARD, UV_PIPE_GET_TYPE(&standard));
  ASSERT(UV_PIPE_TYPE_IS_STANDARD(&standard));

  /* IPC pipes preserve the legacy uv_pipe_init(..., ipc=1) behavior. */
  ASSERT_OK(uv_pipe_init2(loop, &ipc, UV_PIPE_IPC));
  ASSERT_EQ(UV_PIPE_IPC, UV_PIPE_GET_TYPE(&ipc));
  ASSERT(UV_PIPE_TYPE_IS_IPC(&ipc));

  /* Straw pipes opt into child-stdio reclamation without IPC framing. */
  ASSERT_OK(uv_pipe_init2(loop, &straw, UV_PIPE_STRAW));
  ASSERT_EQ(UV_PIPE_STRAW, UV_PIPE_GET_TYPE(&straw));
  ASSERT(UV_PIPE_TYPE_IS_STRAW(&straw));

  /* uv_pipe_init2() is public API, so invalid types report UV_EINVAL. */
  ASSERT_EQ(UV_EINVAL,
            uv_pipe_init2(loop, &invalid, (uv_pipe_type_t) -1));

  uv_close((uv_handle_t*) &standard, NULL);
  uv_close((uv_handle_t*) &ipc, NULL);
  uv_close((uv_handle_t*) &straw, NULL);

  ASSERT_OK(uv_run(loop, UV_RUN_DEFAULT));

  MAKE_VALGRIND_HAPPY(loop);
  return 0;
}


TEST_IMPL(pipe_type_predicates) {
  uv_loop_t* loop;
  uv_pipe_t legacy_standard;
  uv_pipe_t legacy_ipc;
  uv_pipe_t standard;
  uv_pipe_t ipc;
  uv_pipe_t straw;

  loop = uv_default_loop();

  /* Legacy uv_pipe_init(..., ipc=0) creates a standard pipe. */
  ASSERT_OK(uv_pipe_init(loop, &legacy_standard, 0));
  ASSERT_EQ(UV_PIPE_STANDARD, UV_PIPE_GET_TYPE(&legacy_standard));
  ASSERT(UV_PIPE_TYPE_IS_STANDARD(&legacy_standard));

  /* Legacy uv_pipe_init(..., ipc=1) creates an IPC pipe. */
  ASSERT_OK(uv_pipe_init(loop, &legacy_ipc, 1));
  ASSERT_EQ(UV_PIPE_IPC, UV_PIPE_GET_TYPE(&legacy_ipc));
  ASSERT(UV_PIPE_TYPE_IS_IPC(&legacy_ipc));

  /* uv_pipe_init2() exposes the complete pipe type set. */
  ASSERT_OK(uv_pipe_init2(loop, &standard, UV_PIPE_STANDARD));
  ASSERT_EQ(UV_PIPE_STANDARD, UV_PIPE_GET_TYPE(&standard));
  ASSERT(UV_PIPE_TYPE_IS_STANDARD(&standard));

  ASSERT_OK(uv_pipe_init2(loop, &ipc, UV_PIPE_IPC));
  ASSERT_EQ(UV_PIPE_IPC, UV_PIPE_GET_TYPE(&ipc));
  ASSERT(UV_PIPE_TYPE_IS_IPC(&ipc));

  ASSERT_OK(uv_pipe_init2(loop, &straw, UV_PIPE_STRAW));
  ASSERT_EQ(UV_PIPE_STRAW, UV_PIPE_GET_TYPE(&straw));
  ASSERT(UV_PIPE_TYPE_IS_STRAW(&straw));

  uv_close((uv_handle_t*) &legacy_standard, NULL);
  uv_close((uv_handle_t*) &legacy_ipc, NULL);
  uv_close((uv_handle_t*) &standard, NULL);
  uv_close((uv_handle_t*) &ipc, NULL);
  uv_close((uv_handle_t*) &straw, NULL);

  ASSERT_OK(uv_run(loop, UV_RUN_DEFAULT));

  MAKE_VALGRIND_HAPPY(loop);
  return 0;
}
