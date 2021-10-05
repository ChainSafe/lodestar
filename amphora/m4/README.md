# Amphora M4

This is an Ethereum _merge interop_ testnet to check if various consensus/execution client combos can interop with each other and sync to a common chain.

In this specific version validation is done by the master-node, which is a Lighthouse consensus client backed by a Geth execution client. You should be able to connect to it via your favorite client combo and check that you can both connect to it, sync it and transact on it.

Specs:

- Execution layer genesis specs (Geth style): [`genesis.json`](./genesis.json)
- Execution layer bootnode: `enode://ead4b0e2afd49a70ca57a017a59611675ca4464c9d551396711020cea09d6ce974072c7ec0766cc38f4817a33fafcc7f8cbd070feb1ea84e798ee92dfee24675@35.178.114.73:30303`
- Consensus layer genesus spec (Lighthouse style): [beaconspec](./beaconspec)
- Consensus layer bootnode: `/ip4/35.178.114.73/tcp/9000`

Howtos:

- Configure a [Geth execution client](./README-Execution-Geth.md)
- Configure a [Lighthouse consensus client](./README-Consensus-Lighthouse.md)
