# V8 Pointer Compression build
# Uses platformatic/node-caged which includes V8 compiled with pointer compression.
# This is NOT available in standard Node.js — it requires a custom V8 build.
# Expected: ~50% heap reduction, 4GB cage limit per isolate.
FROM platformatic/node-caged:25-slim AS build_src
ARG COMMIT
WORKDIR /usr/app
RUN apt-get update && apt-get install -y git g++ make python3 python3-setuptools && apt-get clean && rm -rf /var/lib/apt/lists/*

# corepack was removed in Node 25, install pnpm directly
RUN npm install -g pnpm@9

COPY . .

ENV CI=true
RUN pnpm install --frozen-lockfile && \
  pnpm build && \
  pnpm clean:nm && \
  pnpm install --frozen-lockfile --prod

# To have access to the specific branch and commit used to build this source,
# a git-data.json file is created by persisting git data at build time. Then,
# a version string like `v0.35.0-beta.0/HEAD/82219149 (git)` can be shown in
# the terminal and in the logs; which is very useful to track tests better.
RUN cd packages/cli && GIT_COMMIT=${COMMIT} pnpm write-git-data

# Copy built src + node_modules to a new layer to prune unnecessary fs
# Previous layer weights 7.25GB, while this final 488MB (as of Oct 2020)
FROM platformatic/node-caged:25-slim
RUN npm install -g pnpm@9
WORKDIR /usr/app
COPY --from=build_src /usr/app .

# With V8 pointer compression, the heap is limited to a 4GB "cage" per isolate.
# Setting --max-old-space-size higher than 4096 is silently clamped by V8.
# 4096 gives the full cage capacity (~equivalent to 8GB uncompressed).
ENV NODE_OPTIONS=--max-old-space-size=4096

ENTRYPOINT ["node", "./packages/cli/bin/lodestar"]
