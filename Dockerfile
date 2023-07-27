
# --platform=$BUILDPLATFORM is used build javascript source with host arch
# Otherwise TS builds on emulated archs and can be extremely slow (+1h)
FROM --platform=${BUILDPLATFORM:-amd64} node:18-alpine as build_src
ARG COMMIT
WORKDIR /usr/app
RUN apk update && apk add --no-cache g++ make python3 && rm -rf /var/cache/apk/*

COPY . .

RUN yarn install --non-interactive --frozen-lockfile && \
  yarn build && \
  yarn install --non-interactive --frozen-lockfile --production

# To have access to the specific branch and commit used to build this source,
# a git-data.json file is created by persisting git data at build time. Then,
# a version string like `v0.35.0-beta.0/HEAD/82219149 (git)` can be shown in
# the terminal and in the logs; which is very useful to track tests better.
RUN cd packages/cli && GIT_COMMIT=${COMMIT} yarn write-git-data


# Copy built src + node_modules to build native packages for archs different than host.
# Note: This step is redundant for the host arch
FROM node:18-alpine as build_deps
WORKDIR /usr/app
RUN apk update && apk add --no-cache g++ make python3 && rm -rf /var/cache/apk/*

COPY --from=build_src /usr/app .

# Do yarn --force to trigger a rebuild of the native packages
# Emmulates `yarn rebuild` which is not available in v1 https://yarnpkg.com/cli/rebuild 
RUN yarn install --non-interactive --frozen-lockfile --production --force
# Rebuild leveldb bindings (required for arm64 build)
RUN cd node_modules/classic-level && yarn rebuild

# Copy built src + node_modules to a new layer to prune unnecessary fs
# Previous layer weights 7.25GB, while this final 488MB (as of Oct 2020)
FROM node:18-alpine
WORKDIR /usr/app
COPY --from=build_deps /usr/app .

# NodeJS applications have a default memory limit of 2.5GB.
# This limit is bit tight for a Prater node, it is recommended to raise the limit
# since memory may spike during certain network conditions.
ENV NODE_OPTIONS=--max-old-space-size=4096

ENTRYPOINT ["node", "./packages/cli/bin/lodestar"]