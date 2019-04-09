FROM ubuntu:latest

# Install dependencies (namely nodejs)
RUN env DEBIAN_FRONTEND=noninteractive \
    apt-get update && \
	apt-get install -y apt-utils build-essential curl git && \
    curl -sL https://deb.nodesource.com/setup_10.x | bash - && \
    apt-get install -y nodejs && \
    curl -o- -L https://yarnpkg.com/install.sh | bash

# Install lodestar dependencies
COPY package.json yarn.lock /lodestar/
RUN cd /lodestar && $HOME/.yarn/bin/yarn install --pure-lockfile

# build lodestar
COPY . /lodestar
RUN cd /lodestar && $HOME/.yarn/bin/yarn run build

ENTRYPOINT ["/bin/bash"]
