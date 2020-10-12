FROM node:12.13-alpine as build
WORKDIR /usr/app
RUN apk update && apk add --no-cache git g++ make python && rm -rf /var/cache/apk/*

# Installs all deps in the root yarn.lock, which are most of them. To cache before copying the src
COPY package.json yarn.lock ./
RUN yarn install --non-interactive --ignore-optional --frozen-lockfile --ignore-scripts

COPY . .
RUN yarn install --non-interactive --ignore-optional --frozen-lockfile


# Copy built src + node_modules to a new layer to prune unnecessary fs
# Previous layer weights 7.25GB, while this final 488MB (as of Oct 2020)
FROM node:12.13-alpine
WORKDIR /usr/app
COPY --from=build /usr/app .

ENTRYPOINT ["node", "./packages/lodestar-cli/bin/lodestar"]
