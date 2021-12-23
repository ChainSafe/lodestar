FROM node:16-alpine as build
WORKDIR /usr/app
RUN apk update && apk add --no-cache g++ make python3 && rm -rf /var/cache/apk/*

ARG VERSION=latest
ENV VERSION=$VERSION
RUN npm install @chainsafe/lodestar-cli@$VERSION

FROM node:16-alpine
WORKDIR /usr/app
COPY --from=build /usr/app .

# Sanity check
RUN /usr/app/node_modules/.bin/lodestar --help

# NodeJS applications have a default memory limit of 2.5GB.
# This limit is bit tight for a Prater node, it is recommended to raise the limit
# since memory may spike during certain network conditions.
ENV NODE_OPTIONS=--max-old-space-size=4096

ENTRYPOINT ["node", "/usr/app/node_modules/.bin/lodestar"]
