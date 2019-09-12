FROM gcr.io/whiteblock/base:ubuntu1804

RUN apt-get update
RUN apt-get install -y python g++ linux-headers-$(uname -r) paxctl gcc musl-dev
RUN curl -sL https://deb.nodesource.com/setup_10.x | bash -
RUN apt-get update && apt-get install -f -y nodejs
RUN npm install -g yarn

RUN git clone https://github.com/ChainSafe/lodestar.git
WORKDIR /lodestar
RUN git checkout interop

RUN yarn install --frozen-lockfile && node_modules/.bin/lerna bootstrap && yarn cache clean

RUN mkdir /launch

RUN cp /lodestar/scripts/whiteblock_start.sh /launch/start.sh

ENTRYPOINT ["/bin/bash"]
