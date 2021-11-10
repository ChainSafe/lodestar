FROM golang:1.17-alpine as builder
RUN apk add --no-cache gcc musl-dev linux-headers git
WORKDIR /usr/app

RUN git clone -b kintsugi-spec https://github.com/MariusVanDerWijden/go-ethereum.git
RUN cd /usr/app/go-ethereum && go run build/ci.go install ./cmd/geth


# Pull Geth into a second stage deploy alpine container
FROM alpine:latest
RUN apk add --no-cache bash curl

RUN apk add --no-cache ca-certificates
COPY --from=builder usr/app/go-ethereum/build/bin/geth /usr/local/bin/

WORKDIR /usr/app

EXPOSE 30303 30303/udp
ENTRYPOINT ["geth"]
