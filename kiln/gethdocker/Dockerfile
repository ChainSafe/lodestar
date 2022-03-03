# Build Geth in a stock Go builder container
FROM golang:1.17-alpine as builder

RUN apk add --no-cache gcc musl-dev linux-headers git bash

RUN git clone --depth 1 -b merge-kiln-v2 https://github.com/MariusVanDerWijden/go-ethereum.git /go-ethereum
RUN cd /go-ethereum && go run build/ci.go install ./cmd/geth

FROM alpine:latest
COPY --from=builder /go-ethereum/build/bin/geth /usr/local/bin/

EXPOSE 8545 8546 30303 30303/udp
ENTRYPOINT ["geth"]