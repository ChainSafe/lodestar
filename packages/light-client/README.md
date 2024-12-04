# Lodestar Light Client

Ethereum light clients provide a pathway for users to interact with the Ethereum blockchain in a trust-minimized manner, comparable to the level of trust required when engaging with a third-party provider like Infura or EtherScan. Not that those platforms are bad, but trust in any centralized provider goes against the ethos of blockchain. Light clients are a way that low-power devices, like cell phones, can do self validation of transactions and dApp state.

Unlike full nodes, light clients do not download and store the entire blockchain. Instead, they download only the headers of each block and employ Merkle proofs to verify transactions. This enables a quick synchronization with the network and access the latest information without using significant system resources​. This streamlined approach to accessing Ethereum is crucial, especially in scenarios where full-scale network participation is infeasible or undesired.

The evolution of light clients is emblematic of the broader trajectory of Ethereum towards becoming more accessible and resource-efficient, making blockchain technology more inclusive and adaptable to a wide array of use cases and environments. The Altair hard fork introduced sync committees to allow light-clients to synchronize to the network.

## Prerequisites

[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
[![Eth Consensus Spec v1.4.0](https://img.shields.io/badge/ETH%20consensus--spec-1.4.0-blue)](https://github.com/ethereum/consensus-specs/releases/tag/v1.4.0)
![ES Version](https://img.shields.io/badge/ES-2021-yellow)
![Node Version](https://img.shields.io/badge/node-16.x-green)
![Yarn](https://img.shields.io/badge/yarn-%232C8EBB.svg?style=for-the-badge&logo=yarn&logoColor=white)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

## Requirements for Running a Light-Client

Access to an beacon node that supports the light client specification is necessary. The client must support the following routes from the [consensus API spec](https://github.com/ethereum/beacon-APIs/tree/v2.5.0/apis/beacon/light_client):

- [`GET /eth/v1/beacon/light_client/updates`](https://ethereum.github.io/beacon-APIs/?urls.primaryName=v2.5.0#/Beacon/getLightClientUpdatesByRange)
- [`GET /eth/v1/beacon/light_client/optimistic_update`](https://ethereum.github.io/beacon-APIs/?urls.primaryName=v2.5.0#/Beacon/getLightClientOptimisticUpdate)
- [`GET /eth/v1/beacon/light_client/finality_update`](https://ethereum.github.io/beacon-APIs/?urls.primaryName=v2.5.0#/Beacon/getLightClientFinalityUpdate)
- [`GET /eth/v1/beacon/light_client/bootstrap/{block_root}`](https://ethereum.github.io/beacon-APIs/?urls.primaryName=v2.5.0#/Beacon/getLightClientBootstrap)

System requirements are quite low so its possible to run a light client in the browser as part of a website. There are a few examples of this on github that you can use as reference, our [prover](https://chainsafe.github.io/lodestar/libraries/lightclient-prover/prover) being one of them.

You can find more information about the light-client protocol in the [specification](https://github.com/ethereum/consensus-specs).

## Getting started

- Follow the [installation guide](https://chainsafe.github.io/lodestar/run/getting-started/installation) to install Lodestar.
- Quickly try out the whole stack by [starting a local testnet](https://chainsafe.github.io/lodestar/advanced-topics/setting-up-a-testnet).

## Light-Client CLI Example

It is possible to start up the light-client as a standalone process.

```bash
lodestar lightclient \
    --network sepolia \
    --beaconApiUrl https://lodestar-sepolia.chainsafe.io \
    --checkpointRoot "0xccaff4b99986a7b05e06738f1828a32e40799b277fd9f9ff069be55341fe0229"
```

## Light-Client Programmatic Example

For this example we will assume there is a running beacon node at `https://lodestar-sepolia.chainsafe.io`

```ts
import {Lightclient, LightclientEvent} from "@lodestar/light-client";
import {LightClientRestTransport} from "@lodestar/light-client/transport";
import {
  getFinalizedSyncCheckpoint,
  getGenesisData,
  getConsoleLogger,
  getApiFromUrl,
  getChainForkConfigFromNetwork,
} from "@lodestar/light-client/utils";

const config = getChainForkConfigFromNetwork("sepolia");
const logger = getConsoleLogger({logDebug: Boolean(process.env.DEBUG)});
const api = getApiFromUrl("https://lodestar-sepolia.chainsafe.io", "sepolia");

const lightclient = await Lightclient.initializeFromCheckpointRoot({
  config,
  logger,
  transport: new LightClientRestTransport(api),
  genesisData: await getGenesisData(api),
  checkpointRoot: await getFinalizedSyncCheckpoint(api),
  opts: {
    allowForcedUpdates: true,
    updateHeadersOnForcedUpdate: true,
  },
});

// Wait for the lightclient to start
await lightclient.start();

logger.info("Lightclient synced");

lightclient.emitter.on(LightclientEvent.lightClientFinalityHeader, async (finalityUpdate) => {
  logger.info("Received finality update", {slot: finalityUpdate.beacon.slot});
});

lightclient.emitter.on(LightclientEvent.lightClientOptimisticHeader, async (optimisticUpdate) => {
  logger.info("Received optimistic update", {slot: optimisticUpdate.beacon.slot});
});
```

## Browser Integration

If you want to use Lightclient in browser and facing some issues in building it with bundlers like webpack, vite. We suggest to use our distribution build. The support for single distribution build is started from `1.20.0` version.

Directly link the dist build with the `<script />` tag with tools like unpkg or other. e.g.

```html
<script src="https://www.unpkg.com/@lodestar/light-client@1.20.0/dist/lightclient.min.mjs" type="module">
```

Then the lightclient package will be exposed to `globalThis`, in case of browser environment that will be `window`. You can access the package as `window.lodestar.lightclient`. All named exports will also be available from this interface. e.g. `window.lodestar.lightclient.transport`.

NOTE: Due to `top-level-await` used in one of dependent library, the package will not be available right after the load. You have to use a hack to clear up that await from the event loop.

```html
<script>
  window.addEventListener("DOMContentLoaded", () => {
    setTimeout(function () {
      // here you can access the Lightclient
      // window.lodestar.lightclient
    }, 50);
  });
</script>

**Typescript support** The web bundle comes with the types support. Unfortunately due to following
[issue](https://github.com/microsoft/rushstack/issues/1128#issuecomment-2066257538) we can't bundle all types. A
workaround would be to add `@chainsafe/as-sha256` as a devDependency to your project.
```

## Contributors

Read our [contribution documentation](https://chainsafe.github.io/lodestar/contribution/getting-started), [submit an issue](https://github.com/ChainSafe/lodestar/issues/new/choose) or talk to us on our [discord](https://discord.gg/yjyvFRP)!

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
