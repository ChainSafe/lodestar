# External Signer

Lodestar supports connecting to multiple external signing servers like [Web3Signer](https://docs.web3signer.consensys.io/), [Diva](https://docs.shamirlabs.org/),
or any other service implementing the [remote signing specification](https://github.com/ethereum/remote-signing-api). This allows the validator client
to operate without storing any validator private keys locally by delegating the signing of messages (e.g. attestations, beacon blocks) to the external signers
which are accessed through a [REST API](https://ethereum.github.io/remote-signing-api/) via HTTP(S). This API should not be exposed directly to the public
Internet and appropriate firewall rules should be in place to restrict access only from the validator client.

## Configuration

Lodestar provides [CLI options](./validator-cli.md#--externalsignerurl) to connect to one or more external signers.

### Single External Signer

To connect to a single external signer:

```sh
./lodestar validator --externalSigner.url "http://localhost:9000" --externalSigner.fetch
```

### Multiple External Signers

To connect to multiple external signers, use the `--externalSigner.urls` flag:

```sh
./lodestar validator --externalSigner.urls "http://localhost:9000,http://localhost:9001" --externalSigner.fetch
```

You can also specify multiple URLs using repeated flags:

```sh
./lodestar validator --externalSigner.urls "http://localhost:9000" --externalSigner.urls "http://localhost:9001" --externalSigner.fetch
```

The validator client will fetch the list of public keys from all external signers and automatically keep them in sync with signers in local validator store
by adding newly discovered public keys and removing no longer present public keys on external signers.

By default, the list of public keys will be fetched from all external signers once per epoch (6.4 minutes). This interval can be configured by setting [`--externalSigner.fetchInterval`](./validator-cli.md#--externalsignerfetchinterval) flag which takes a number in milliseconds.

Alternatively, if it is not desired to use all public keys imported on the external signers, it is also possible to explicitly specify a list of public keys to use
by setting the [`--externalSigner.pubkeys`](./validator-cli.md#--externalsignerpubkeys) flag instead of [`--externalSigner.fetch`](./validator-cli.md#--externalsignerfetch).

## Error Handling

When using multiple external signers, the validator client will handle errors from individual signers gracefully. If one signer fails to respond or returns an error,
the client will continue to operate with the remaining signers. This ensures that the validator client remains operational even if some external signers are temporarily
unavailable.

## Best Practices

1. Use HTTPS for all external signer connections to ensure secure communication
2. Implement proper firewall rules to restrict access to external signers
3. Monitor external signer health and availability
4. Consider using a load balancer for high availability setups
5. Keep external signer software up to date with the latest security patches
