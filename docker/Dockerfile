FROM node:10.16-alpine

WORKDIR /usr/app

RUN apk add --update git python make g++ linux-headers paxctl gcc && \
  rm -rf /tmp/* /var/cache/apk/*

COPY lerna.json .
COPY package.json .
COPY packages/lodestar/package.json ./packages/lodestar/package.json
COPY yarn.lock .

RUN yarn install --frozen-lockfile && node_modules/.bin/lerna bootstrap && yarn cache clean

COPY . .

RUN node_modules/.bin/lerna run build

FROM node:10.16-alpine

RUN apk add --update git python make g++ linux-headers paxctl gcc && \
  rm -rf /tmp/* /var/cache/apk/*

WORKDIR /app

COPY --from=0 /usr/app/packages/lodestar/lib /app/lib
COPY --from=0 /usr/app/packages/lodestar/bin /app/bin
COPY --from=0 /usr/app/packages/lodestar/package.json /app/package.json
COPY --from=0 /usr/app/yarn.lock /app/yarn.lock

RUN yarn install --frozen-lockfile --production && yarn cache clean && apk del git python g++ gcc make

ENTRYPOINT ["/app/bin/lodestar"]
