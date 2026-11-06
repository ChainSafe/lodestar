---
title: Running a Remote Signer
---

# Remote Signer

The Lodestar remote signer serves the [remote signing API](https://github.com/ethereum/remote-signing-api) for a set of
validator keystores. A [validator client](../validator-management/external-signer.md) connected to it never holds the
validator keys, it requests every signature from the signer over HTTP. The signer recomputes the signing root from
the data it is asked to sign and keeps its own slashing protection database, so a validator client cannot make it
produce a slashable block or attestation.

The API must not be exposed to the public internet. Only validator clients should be able to reach it, use a private
network or a reverse proxy with TLS and authentication for connections between hosts.

## Start the signer

Keystores are imported the same way as for the validator client, from a directory of
[EIP-2335 keystore files](https://github.com/ethereum/EIPs/blob/master/EIPS/eip-2335.md) and a password file.

```sh
./lodestar signer --network hoodi --importKeystores ./keystores --importKeystoresPassword ./password.txt
```

By default the API listens on `http://127.0.0.1:9000`. Use [`--address`](./signer-cli.md#--address) and
[`--port`](./signer-cli.md#--port) to change the listen address.

The validator client then fetches the public keys from the signer and requests signatures for them.

```sh
./lodestar validator --network hoodi --externalSigner.url http://127.0.0.1:9000 --externalSigner.fetch
```

## Slashing protection

Every block and attestation signing request is checked against the slashing protection database of the signer at
`$dataDir/signer-db` before a signature is produced. A request that would result in a slashable message is rejected
with HTTP status `412`.

The database is bound to the genesis validators root of the first block or attestation signed. Requests for a different
chain are rejected, run one signer per network.

When moving validators from another client, import its slashing protection history before starting the signer.

```sh
./lodestar signer slashing-protection import --network hoodi --file interchange.json
```

The history can be exported in the [EIP-3076](https://eips.ethereum.org/EIPS/eip-3076) interchange format as well.

```sh
./lodestar signer slashing-protection export --network hoodi --file interchange.json
```

## Monitoring

Prometheus metrics are served on `http://127.0.0.1:5066/metrics` when started with
[`--metrics`](./signer-cli.md#--metrics). Signing requests are counted by message type and result in
`signer_sign_requests_total`.
