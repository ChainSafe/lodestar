# MEV & Merge

MEV is a term that refers to the bundling of transactions in one particular order to extract (mostly) arbitrage opportunities on the dApps and decentralized exchanges.

And the ones who gets to include these execution payloads (miners before the merge, validators after the merge) in the canonical chain get paid a per-block reward which essentially _should be_ higher than the normal payload inclusion reward (including transactions tips).

Currently these happen with miners running forked versions of their favorite execution client, integrating with these "builders" but in the post-merge world they get a more native and standard integration with the CL.

This is what we in CL land refer to as **Builder Api**.

## Lodestar and Builder API

Lodestar offers builder integration through the _spec-ed_ [builder API](https://ethereum.github.io/builder-specs/#/Builder).

This sits in parallel with the execution engine so when enabled, lodestar validator run both flows in parallel when its time to propose for a validator key and currently (naively) picks the builder block in preference to execution if a builder block is fetched (else just proceeds with the execution block).

## Configure Lodestar setup for MEV

All you have to do is:

1. Provide lodestar beacon node with a Builder endpoint (which corresponds to the network you are running) via these additional flags:
   ```shell
   --builder --builder.urls <builder/relay/boost url>
   ```
2. Run lodestar validator client with these additional flags
   ```shell
   --builder --suggestedFeeRecipient <your ethereum address>
   ```

There are some more builder flags available in lodestar cli (for both beacon and validator) which you may inspect and use.

Even though its possible to directly hook lodestar with an external Builder/Relay, its recommended to interface it with the MEV world via [local MEV-BOOST multiplexer](https://github.com/flashbots/mev-boost) which can integrate multiple builder/relays for you and provide some payload verification on top, as currently Lodestar assumes this to be a trusted endpoint.
