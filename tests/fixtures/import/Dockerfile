FROM busybox:latest@sha256:fd7dc98638c8e305f4dc34e979f1c0fdfdcaeb0fbf8fcff77ae834b6da3d7e6e
RUN \
  --mount=type=cache,target=./tests/fixture/cache,sharing=locked \
  echo "Hello, world!" > /tests/fixture/cache/hello.txt

