# Local libuv Refresh

This is a development workflow for draft Node.js/libuv integration work. It
mirrors the shape of `update-libuv.sh`, but uses a sibling libuv checkout
instead of a released GitHub tarball.

Assume the repositories are siblings:

```text
GitHub/
  libuv/
  node/
```

The Node updater replaces `deps/uv` wholesale while preserving Node-owned build
files. The local refresh does the same thing.

From the `node` checkout, run:

```powershell
$node = Resolve-Path .
$libuv = Resolve-Path ..\libuv
$tmp = New-Item -ItemType Directory -Force "$env:TEMP\node-libuv-refresh"

Remove-Item -Recurse -Force "$tmp\uv" -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$tmp\uv" | Out-Null

$buildFiles = Get-ChildItem deps\uv\* -Include *.gyp, *.gypi, *.gn, *.gni
Copy-Item $buildFiles $tmp
git -C $libuv archive HEAD | tar -x -C "$tmp\uv"

Remove-Item -Recurse -Force deps\uv
Move-Item "$tmp\uv" deps\uv
Move-Item (Get-ChildItem $tmp\* -Include *.gyp, *.gypi, *.gn, *.gni) deps\uv

git -C $libuv log -1 --oneline
git status --short deps\uv
```

That leaves `deps/uv` as a snapshot of the current sibling libuv commit plus
the Node build files. Review the diff, then commit it as the libuv vendor
layer. Node-only changes should live in a later commit on top.
