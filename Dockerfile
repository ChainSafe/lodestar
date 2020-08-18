FROM node:12.13-alpine

RUN apk update && apk add --no-cache git g++ make python && rm -rf /var/cache/apk/*

WORKDIR /usr/app

# Install node dependencies - done in a separate step so Docker can cache it.
COPY . .

RUN yarn install --force --network-timeout 1000000 --non-interactive --ignore-optional --frozen-lockfile && yarn cache clean

WORKDIR /usr/app/packages/lodestar-cli/bin

ENTRYPOINT ["node", "lodestar"]
