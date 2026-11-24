# syntax=docker/dockerfile:1.7

ARG BUN_VERSION
FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY patches ./patches
COPY apps/cli/package.json ./apps/cli/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/package.json
COPY packages/headers/package.json ./packages/headers/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

FROM deps AS build
WORKDIR /app
COPY apps ./apps
COPY packages ./packages
RUN bun run build

FROM oven/bun:${BUN_VERSION}-debian AS runtime
WORKDIR /work
USER root
# Use the same patched browser dependency as the compiled CLI.
RUN --mount=from=deps,source=/app,target=/app bun /app/node_modules/playwright/cli.js install chrome --with-deps
COPY --from=build /app/dist/boathook /usr/local/bin/boathook
USER bun
ENTRYPOINT ["boathook"]
CMD ["--help"]
