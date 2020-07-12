FROM node:12.13-alpine

RUN apk update && apk add --no-cache git g++ make python && rm -rf /var/cache/apk/*

WORKDIR /usr/app

# Install node dependencies - done in a separate step so Docker can cache it.
COPY package.json yarn.lock lerna.json ./
# Use --ignore-scripts to trigger the build latter
RUN yarn --frozen-lockfile --non-interactive --ignore-scripts

COPY packages/benchmark-utils/package.json packages/benchmark-utils/
COPY packages/lodestar/package.json packages/lodestar/
COPY packages/lodestar-beacon-state-transition/package.json packages/lodestar-beacon-state-transition/
COPY packages/lodestar-cli/package.json packages/lodestar-cli/
COPY packages/lodestar-config/package.json packages/lodestar-config/
COPY packages/lodestar-params/package.json packages/lodestar-params/
COPY packages/lodestar-spec-test-util/package.json packages/lodestar-spec-test-util/
COPY packages/lodestar-types/package.json packages/lodestar-types/
COPY packages/lodestar-utils/package.json packages/lodestar-utils/
COPY packages/lodestar-validator/package.json packages/lodestar-validator/
COPY packages/spec-test-runner/package.json packages/spec-test-runner/

RUN ./node_modules/.bin/lerna bootstrap -- --frozen-lockfile --non-interactive --ignore-scripts

COPY . .

RUN yarn build

ENTRYPOINT ["node", "./packages/lodestar-cli/bin/lodestar"]
