#######################
#
# To build from source:
#
# Edit root docker-compose.yml
# ```yaml
# services:
#   beacon_node:
#     build:
#       context: .
#       dockerfile: docker/from_source.Dockerfile
# ```
#
# If you need to see the commit and branch in logs + metrics,
# comment this line from .dockerignore
# ```
# .git
# ```
#
#######################

FROM node:14-alpine as build
WORKDIR /usr/app
RUN apk update && apk add --no-cache g++ make python3 && rm -rf /var/cache/apk/*

# Installs all deps in the root yarn.lock, which are most of them. To cache before copying the src
COPY package.json yarn.lock ./
RUN yarn install --non-interactive --frozen-lockfile --ignore-scripts

COPY . .
RUN yarn install --non-interactive --frozen-lockfile && yarn build

# Copy built src + node_modules to a new layer to prune unnecessary fs
# Previous layer weights 7.25GB, while this final 488MB (as of Oct 2020)
FROM node:14-alpine
WORKDIR /usr/app
COPY --from=build /usr/app .

# NodeJS applications have a default memory limit of 2.5GB.
# This limit is bit tight for a Prater node, it is recommended to raise the limit
# since memory may spike during certain network conditions.
ENV NODE_OPTIONS=--max_old_space_size=6144

ENTRYPOINT ["node", "./packages/cli/bin/lodestar"]