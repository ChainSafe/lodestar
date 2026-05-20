FROM node:24-slim AS build_src
ARG COMMIT
WORKDIR /usr/app
RUN apt-get update && apt-get install -y git g++ make python3 python3-setuptools curl xz-utils && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install zig toolchain
# Required by @chainsafe/lodestar-z's `prepare` script
ARG TARGETARCH
ARG ZIG_VERSION=0.16.0
RUN case "${TARGETARCH}" in \
  amd64) ZIG_ARCH=x86_64; ZIG_SHA256=70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00 ;; \
  arm64) ZIG_ARCH=aarch64; ZIG_SHA256=ea4b09bfb22ec6f6c6ceac57ab63efb6b46e17ab08d21f69f3a48b38e1534f17 ;; \
  *) echo "unsupported TARGETARCH=${TARGETARCH}" && exit 1 ;; \
  esac && \
  curl -fsSL "https://ziglang.org/download/${ZIG_VERSION}/zig-${ZIG_ARCH}-linux-${ZIG_VERSION}.tar.xz" -o /tmp/zig.tar.xz && \
  echo "${ZIG_SHA256}  /tmp/zig.tar.xz" | sha256sum -c - && \
  tar -xJf /tmp/zig.tar.xz -C /opt && \
  ln -s /opt/zig-${ZIG_ARCH}-linux-${ZIG_VERSION}/zig /usr/local/bin/zig && \
  rm /tmp/zig.tar.xz && \
  zig version

COPY . .

ENV CI=true
RUN corepack enable && corepack prepare --activate && \
  pnpm install --frozen-lockfile && \
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
FROM node:24-slim
WORKDIR /usr/app
COPY --from=build_src /usr/app .

# NodeJS applications have a default memory limit of 4GB on most machines.
# This limit is bit tight for a Mainnet node, it is recommended to raise the limit
# since memory may spike during certain network conditions.
ENV NODE_OPTIONS=--max-old-space-size=8192

ENTRYPOINT ["node", "./packages/cli/bin/lodestar"]
