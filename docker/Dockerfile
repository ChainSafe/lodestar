FROM ubuntu:latest 

# Install dependencies (namely nodejs)
RUN env DEBIAN_FRONTEND=noninteractive \
    apt-get update && \
	apt-get install -y apt-utils build-essential curl git && \
    curl -sL https://deb.nodesource.com/setup_10.x | bash - && \
    apt-get install -y nodejs

# Install lodestar dependencies
COPY package.json package-lock.json /lodestar/
RUN cd /lodestar && npm install

# build lodestar
COPY . /lodestar
RUN cd /lodestar && npm run build

ENTRYPOINT ["/bin/bash"]
