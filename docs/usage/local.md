# Local testnet

To quickly test and run Lodestar we recommend to start a local testnet. We recommend a simple configuration of two beacon nodes with multiple validators

**Terminal 1**

Run a beacon node with 8 validators and default settings. State will be written to .tmp/state.ssz

```bash
yarn run cli dev --dev.genesisValidators 8 --dev.reset
```

**Terminal 2**

Connect to bootnode (node 1 default multiaddrs) but without starting validators.

```bash
yarn run cli dev --dev.startValidators 0:0 \
  --chain.genesisStateFile ./dev/genesis.ssz \
  --network.localMultiaddrs /ip4/127.0.0.1/tcp/30607 \
  --sync.minPeers 1
```

---

Once both instances are running you should see an output similar to this

**Terminal 1**

```bash
2020-06-21 16:42:40  [SYNC]             warn: Current peerCount=0, required = 2
2020-06-21 16:42:43  [SYNC]             warn: Current peerCount=0, required = 2
2020-06-21 16:42:43  [VALIDATOR 7]      info: Validator is proposer at slot 9
2020-06-21 16:42:43  [CHAIN]            info: Processed new chain head newChainHeadRoot=0x3223a51b51fa4f42ea2281e8580806907a8e69f490cfe12a380b8e8b41b21d27, slot=9, epoch=1
2020-06-21 16:42:43  [VALIDATOR 7]      info: Proposed block with hash 0x3223a51b51fa4f42ea2281e8580806907a8e69f490cfe12a380b8e8b41b21d27 and slot 9
2020-06-21 16:42:46  [SYNC]             warn: Current peerCount=1, required = 2
2020-06-21 16:42:49  [SYNC]             warn: Current peerCount=1, required = 2
2020-06-21 16:42:49  [VALIDATOR 6]      info: Validator is proposer at slot 10
2020-06-21 16:42:49  [CHAIN]            info: Processed new chain head newChainHeadRoot=0x7c3a77ad892ca631b750b988277a6caca9cc011461e326537fb607c94359b95f, slot=10, epoch=1
2020-06-21 16:42:49  [VALIDATOR 6]      info: Proposed block with hash 0x7c3a77ad892ca631b750b988277a6caca9cc011461e326537fb607c94359b95f and slot 10
2020-06-21 16:42:52  [SYNC]             warn: Current peerCount=1, required = 2
2020-06-21 16:42:55  [SYNC]             warn: Current peerCount=1, required = 2
2020-06-21 16:42:55  [VALIDATOR 2]      info: Validator is proposer at slot 11
2020-06-21 16:42:55  [CHAIN]            info: Processed new chain head newChainHeadRoot=0x74e96be4058e0edec26028c2f727b30dbc05e12c3f29f364e487916e16777f4a, slot=11, epoch=1
2020-06-21 16:42:55  [VALIDATOR 2]      info: Proposed block with hash 0x74e96be4058e0edec26028c2f727b30dbc05e12c3f29f364e487916e16777f4a and slot 11
```

**Terminal 2**

```bash
2020-06-21 16:42:49  [SYNC]             info: Sync caught up to latest slot 9
2020-06-21 16:42:49  [CHAIN]            info: Processed new chain head newChainHeadRoot=0x7c3a77ad892ca631b750b988277a6caca9cc011461e326537fb607c94359b95f, slot=10, epoch=1
2020-06-21 16:42:56  [CHAIN]            info: Processed new chain head newChainHeadRoot=0x74e96be4058e0edec26028c2f727b30dbc05e12c3f29f364e487916e16777f4a, slot=11, epoch=1
2020-06-21 16:43:01  [CHAIN]            info: Processed new chain head newChainHeadRoot=0x75ff1e7143acead878913a516c87f620022e178298e7a7f4a9485fd731bc7128, slot=12, epoch=1
2020-06-21 16:43:07  [CHAIN]            info: Processed new chain head newChainHeadRoot=0x250da6f5ebad021894eb07824b535c3442fe0f7a67949f266d46ffa6b5a18b76, slot=13, epoch=1
2020-06-21 16:43:13  [CHAIN]            info: Processed new chain head newChainHeadRoot=0x2e90c4a2cea722cb8bfccdfe3b73a4211e7a21d07075d11307626d8b048b9074, slot=14, epoch=1
2020-06-21 16:43:19  [CHAIN]            info: Processed new chain head newChainHeadRoot=0x03fcff4f23de519c1e294f6b1256d194199c107c56b4466efed6bfab8d6e7e92, slot=15, epoch=1
```
