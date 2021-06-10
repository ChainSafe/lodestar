FROM node:14-alpine as build
WORKDIR /usr/app
RUN apk update && apk add --no-cache g++ make python && rm -rf /var/cache/apk/*

ARG VERSION=latest
ENV VERSION=$VERSION
RUN npm install @chainsafe/lodestar-cli@$VERSION

FROM node:14-alpine
WORKDIR /usr/app
COPY --from=build /usr/app .
# Sanity check
RUN /usr/app/node_modules/.bin/lodestar --help

ENTRYPOINT ["node", "--max-old-space-size=8192", "/usr/app/lodestar"]
