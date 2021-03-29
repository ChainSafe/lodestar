FROM node:14-alpine as build
WORKDIR /usr/app
RUN apk update && apk add --no-cache git g++ make python && rm -rf /var/cache/apk/*

# Installs all deps in the root yarn.lock, which are most of them. To cache before copying the src
COPY package.json yarn.lock ./
RUN yarn install --non-interactive --frozen-lockfile --ignore-scripts

COPY . .
RUN yarn install --non-interactive --frozen-lockfile

# rm .git afterwards to prevent copying it to the final layer (~350MB)
RUN node ./scripts/getGitData /usr/app/.git-data.json && rm -r .git


# Copy built src + node_modules to a new layer to prune unnecessary fs
# Previous layer weights 7.25GB, while this final 488MB (as of Oct 2020)
FROM node:14-alpine
WORKDIR /usr/app
COPY --from=build /usr/app .
ENV DOCKER_LODESTAR_GIT_DATA_FILEPATH /usr/app/.git-data.json

ENTRYPOINT ["node", "./packages/cli/bin/lodestar"]
