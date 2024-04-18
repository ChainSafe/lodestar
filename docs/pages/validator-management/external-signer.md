# External Signer

Lodestar supports connecting an external signing server like [Web3Signer](https://docs.web3signer.consensys.io/), [Diva](https://docs.shamirlabs.org/),
or any other service implementing the [remote signing specification](https://github.com/ethereum/remote-signing-api). This allows the validator client
to operate without storing any validator private keys locally by delegating the signing of messages (e.g. attestations, beacon blocks) to the external signer
which is accessed through a [REST API](https://ethereum.github.io/remote-signing-api/) via HTTP(S). This API should not be exposed directly to the public
Internet and appropriate firewall rules should be in place to restrict access only from the validator client.

## Configuration

Lodestar provides [CLI options](./validator-cli.md#--externalsignerurl) to configure an external signer.

```sh
./lodestar validator --externalSigner.url "http://localhost:9000" --externalSigner.fetch
```

The validator client will fetch the list of public keys from the external signer and automatically keep them in sync with signers in local validator store
by adding newly discovered public keys and removing no longer present public keys on external signer.

By default, the list of public keys will be fetched from the external signer once per epoch (6.4 minutes). This interval can be configured by setting [`--externalSigner.fetchInterval`](./validator-cli.md#--externalsignerfetchinterval) flag which takes a number in milliseconds.

Alternatively, if it is not desired to use all public keys imported on the external signer, it is also possible to explicitly specify a list of public keys to use
by setting the [`--externalSigner.pubkeys`](./validator-cli.md#--externalsignerpubkeys) flag.
