FROM node:14-alpine as base
WORKDIR /usr/app
RUN apk update && apk add --no-cache git g++ make python && rm -rf /var/cache/apk/*

FROM base as development
RUN apk add --no-cache bash
RUN yarn global add ts-node typescript

FROM base as build
# Installs all deps in the root yarn.lock, which are most of them. To cache before copying the src
COPY package.json yarn.lock ./
RUN yarn install --non-interactive --frozen-lockfile --ignore-scripts

COPY . .
RUN yarn install --non-interactive --frozen-lockfile

RUN node ./scripts/getGitData /usr/app/.git-data.json

# Copy built src + node_modules to a new layer to prune unnecessary fs
# Previous layer weights 7.25GB, while this final 488MB (as of Oct 2020)
FROM node:14-alpine as production
WORKDIR /usr/app
COPY --from=build /usr/app .
ENV DOCKER_LODESTAR_GIT_DATA_FILEPATH /usr/app/.git-data.json

ENTRYPOINT ["node", "./packages/lodestar-cli/bin/lodestar"]

