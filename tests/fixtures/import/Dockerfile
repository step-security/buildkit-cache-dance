FROM busybox:latest@sha256:dc2d74b28e4cf8984fa52af1f39bc7c3d9c73760b41a74d629f5d11b1ab28616
RUN \
  --mount=type=cache,target=./tests/fixture/cache,sharing=locked \
  echo "Hello, world!" > /tests/fixture/cache/hello.txt

