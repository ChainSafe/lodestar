FROM ubuntu:latest 

ENV DEBIAN_FRONTEND noninteractive
RUN apt-get update &&\ 
	apt-get install -y apt-utils iputils-ping expect git git-extras software-properties-common tmux vim \
	inetutils-tools wget ca-certificates curl build-essential libssl-dev iperf3 openssh-server 
RUN apt-get update && apt-get install -f -y npm nodejs

# builds out lodestar
RUN git clone https://github.com/ChainSafeSystems/lodestar
WORKDIR /lodestar
RUN npm install --no-optional
RUN npm test
WORKDIR /

ENTRYPOINT ["/bin/bash"]
