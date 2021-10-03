FROM golang:1.17-alpine as builder
RUN apk add --no-cache gcc musl-dev linux-headers git
WORKDIR /usr/app

RUN git clone -b merge-interop-spec https://github.com/MariusVanDerWijden/go-ethereum.git
RUN cd /usr/app/go-ethereum && go run build/ci.go install ./cmd/geth


# Pull Geth into a second stage deploy alpine container
FROM alpine:latest

RUN apk add --no-cache ca-certificates
COPY --from=builder usr/app/go-ethereum/build/bin/geth /usr/local/bin/

WORKDIR /usr/app
COPY genesis.json genesis.json

RUN geth --catalyst --datadir /data init genesis.json
EXPOSE 8545 8546 30303 30303/udp
ENTRYPOINT ["geth"]
#RUN apk add --no-cache bash curl
