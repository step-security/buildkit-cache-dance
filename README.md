[![StepSecurity Maintained Action](https://raw.githubusercontent.com/step-security/maintained-actions-assets/main/assets/maintained-action-banner.png)](https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions)

# The BuildKit Cache Dance
Save `RUN --mount=type=cache` caches on GitHub Actions or other CI platforms

The BuildKit Cache Dance allows saving [`RUN --mount=type=cache`](https://docs.docker.com/build/guide/mounts/#add-a-cache-mount)
caches on GitHub Actions or other CI platforms by extracting the cache from the previous build and injecting it into the current build.

Use cases:
- apt-get (`/var/cache/apt`, `/var/lib/apt`)
- Go (`/root/.cache/go-build`)
- etc.

## Examples

### apt-get GitHub Actions

Dockerfile:

```dockerfile
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  rm -f /etc/apt/apt.conf.d/docker-clean && \
  echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' >/etc/apt/apt.conf.d/keep-cache && \
  apt-get update && \
  apt-get install -y gcc
```

Action:

```yaml
---
name: Build
on:
  push:

jobs:
  Build:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v7
      - uses: step-security/setup-buildx-action@v4
        id: setup-buildx
      - uses: step-security/metadata-action@v6
        id: meta
        with:
          images: Build

      - name: Cache
        uses: actions/cache@v6
        id: cache
        with:
          path: cache-mount
          key: cache-mount-${{ hashFiles('Dockerfile') }}

      - name: Restore Docker cache mounts
        uses: step-security/buildkit-cache-dance@v3
        with:
          builder: ${{ steps.setup-buildx.outputs.name }}
          cache-dir: cache-mount
          dockerfile: Dockerfile
          skip-extraction: ${{ steps.cache.outputs.cache-hit }}

      - name: Build and push
        uses: step-security/docker-build-push-action@v7
        with:
          context: .
          cache-from: type=gha
          cache-to: type=gha,mode=max
          file: Dockerfile
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}

```

## CacheMap Options

If you require more fine grained control you can manually specify a JSON formatted `cache-map`. The keys specify the paths on the Docker builder host to use as the bind source and the string value provides the cache mount `target` within the Docker build:

```yaml
      - name: Restore Docker cache mounts
        uses: step-security/buildkit-cache-dance@v3
        with:
          builder: ${{ steps.setup-buildx.outputs.name }}
          cache-map: |
            {
              "var-cache-apt": "/var/cache/apt",
              "var-lib-apt": "/var/lib/apt"
            }
          skip-extraction: ${{ steps.cache.outputs.cache-hit }}
```

Alternatively, you can provide a JSON object with additional options that should be passed to `--mount=type=cache` in the values `cache-map` JSON. The `target` path must be present in the object as a property.

```yaml
      - name: Restore Docker cache mounts
        uses: step-security/buildkit-cache-dance@v3
        with:
          builder: ${{ steps.setup-buildx.outputs.name }}
          cache-map: |
            {
              "var-cache-apt": {
                "target": "/var/cache/apt",
                "id": "1"
              },
              "var-lib-apt": "/var/lib/apt"
            }
          skip-extraction: ${{ steps.cache.outputs.cache-hit }}
```
