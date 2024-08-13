---
title: Setting Up a Testnet
---

# Setting-Up a Testnet

To quickly test and run Lodestar we recommend starting a local testnet. We recommend a simple configuration of two beacon nodes with multiple validators. The [dev scripts](https://github.com/ChainSafe/lodestar/tree/unstable/scripts/dev) can used for simplicity but below instructions provide more insights on how it works and include details about different configurations.

:::note
The testnet set up in this guide is meant to be short-lived / ephemeral and should primarily be used for development and testing. Please refer to [Ethereum In a Box](https://github.com/rocknet/ethiab) or [Kurtosis ethereum package](https://github.com/ethpandaops/ethereum-package) to set up a long-lived private network or devnet.
:::

**Terminal 1**

Run a beacon node as a **bootnode**, with 8 validators with the following command.

```bash
./lodestar dev \
  --genesisValidators 8 \
  --genesisTime 1669713528 \
  --startValidators 0..7 \
  --enr.ip 127.0.0.1 \
  --enr.udp 9000 \
  --dataDir </path/to/node1> \
  --reset
```

[`--genesisValidators`](../dev-cli.md#--genesisvalidators) and [`--genesisTime`](../dev-cli.md#--genesistime) define the genesis state of the beacon chain. [`--dataDir`](../dev-cli.md#--datadir) defines a path where
Lodestar should store the beacon state.
[`--enr.ip`](../dev-cli.md#--enrip) sets the ENR IP entry for the node (essential for second node to connect via `enr`) and [`--enr.udp`](../dev-cli.md#--enrudp) exposes the Discv5 discovery service (if you want to connect more than 1 node and enable discovery amongst them via _bootnode_).
Lastly the [`--reset`](../dev-cli.md#--reset) flag ensures the state is cleared on each restart - which is useful when testing locally.

Once the node has started, make a request to `curl http://localhost:9596/eth/v1/node/identity` and copy the `enr` value.

This would be used to connect from the second node.

> ENR stands for Ethereum node records, which is a format for conveying p2p connectivity information for Ethereum nodes.
> For more info see [EIP-778](https://eips.ethereum.org/EIPS/eip-778).

**Terminal 2**

Start the second node without starting any validators and connect to the first node by supplying the copied `enr` value:

```bash
./lodestar dev \
  --genesisValidators 8 \
  --genesisTime 1669713528 \
  --dataDir </path/to/node2> \
  --port 9001 \
  --rest.port 9597 \
  --network.connectToDiscv5Bootnodes true \
  --bootnodes <enr value> \
  --reset
```

By default, Lodestar starts as many validators as the number supplied by [`--genesisValidators`](../dev-cli.md#--genesisvalidators). In order to not start any validator, this is overridden by
the [`--startValidators`](../dev-cli.md#--startvalidators) option. Passing a value of `0..0` means no validators should be started.

Also, take note that the values of [`--genesisValidators`](../dev-cli.md#--genesisvalidators) and [`--genesisTime`](../dev-cli.md#--genesistime) must be the same as the ones passed to the first node in order for the two nodes
to have the same beacon chain.

Also [`--port`](../dev-cli.md#--port) and [`--rest.port`](../dev-cli.md#--restport) are supplied since the default values will already be in use by the first node.

The `--network.connectToDiscv5Bootnodes` flags needs to be set to true as this is needed to allow connection to boot ENRs on local devnet.
The exact ENR of node to connect to is then supplied via the [`--bootnodes`](../dev-cli.md#--bootnodes) flag.

Once the second node starts, you should see an output similar to the following in either of the terminals:

```txt
Eph 167991/6 6.007 []  info: Searching peers - peers: 1 - slot: 5375718 (skipped 5375718) - head: 0 0xcc67…3345 - finalized: 0x0000…0000:0
```

For further confirmation that both nodes are connected as peers, make a request to the `/eth/v1/node/peers` endpoint.

For example, making the request on the first node via the following command:

`curl http://localhost:9596/eth/v1/node/peers | jq`

will give a result similar to the following:

```json
{
  "data": [
    {
      "peer_id": "...",
      "enr": "",
      "last_seen_p2p_address": "....",
      "direction": "inbound",
      "state": "connected"
    }
  ],
  "meta": {
    "count": 1
  }
}
```

## Post-Merge local testnet

To set up a local testnet with a Post-Merge configuration, you may need to add the following parameters (in addition to the parameters described above) to your [`lodestar dev`](../dev-cli.md#dev-options) command:

- `--params.ALTAIR_FORK_EPOCH 0`
- `--params.BELLATRIX_FORK_EPOCH 0`
- `--terminal-total-difficulty-override 0`
