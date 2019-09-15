FROM node:10

RUN npm install -g yarn

COPY . /root/lodestar

WORKDIR /root/lodestar

RUN yarn

#ENTRYPOINT ["./packages/lodestar/bin/lodestar"]
CMD ./packages/lodestar/bin/lodestar interop -p minimal --db l1 -q 1568584956,8 --multiaddrs /ip4/127.0.0.1/tcp/30607 -r -v 8




