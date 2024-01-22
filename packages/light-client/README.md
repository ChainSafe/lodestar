# Lodestar Light Client

Ethereum light clients provide a pathway for users to interact with the Ethereum blockchain in a trust-minimized manner, comparable to the level of trust required when engaging with a third-party provider like Infura or EtherScan. Not that those platforms are bad, but trust in any centralized provider goes against the ethos of blockchain. Light clients are a way that low-power devices, like cell phones, can do self validation of transactions and dApp state.

Unlike full nodes, light clients do not download and store the entire blockchain. Instead, they download only the headers of each block and employ Merkle proofs to verify transactions. This enables a quick synchronization with the network and access the latest information without using significant system resources​. This streamlined approach to accessing Ethereum is crucial, especially in scenarios where full-scale network participation is infeasible or undesired.

The evolution of light clients is emblematic of the broader trajectory of Ethereum towards becoming more accessible and resource-efficient, making blockchain technology more inclusive and adaptable to a wide array of use cases and environments. The Altair hard fork introduced sync committees to allow light-clients to synchronize to the network.

## Prerequisites

[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
[![Eth Consensus Spec v1.1.10](https://img.shields.io/badge/ETH%20consensus--spec-1.1.10-blue)](https://github.com/ethereum/consensus-specs/releases/tag/v1.1.10)
![ES Version](https://img.shields.io/badge/ES-2021-yellow)
![Node Version](https://img.shields.io/badge/node-16.x-green)
![Yarn](https://img.shields.io/badge/yarn-%232C8EBB.svg?style=for-the-badge&logo=yarn&logoColor=white)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

## Requirements for Running a Light-Client

Access to an beacon node that supports the light client specification is necessary. The client must support the following routes from the [consensus API spec](https://github.com/ethereum/consensus-specs/tree/dev):

- `/eth/v1/beacon/light_client/updates`
- `/eth/v1/beacon/light_client/optimistic_update`
- `/eth/v1/beacon/light_client/finality_update`
- `/eth/v1/beacon/light_client/bootstrap/{block_root}`
- `/eth/v0/beacon/light_client/committee_root`

System requirements are quite low so its possible to run a light client in the browser as part of a website. There are a few examples of this on github that you can use as reference, our [prover](https://chainsafe.github.io/lodestar/lightclient-prover/prover) being one of them.

You can find more information about the light-client protocol in the [specification](https://github.com/ethereum/consensus-specs).

## Getting started

- Follow the [installation guide](https://chainsafe.github.io/lodestar/getting-started/installation) or [Docker install](https://chainsafe.github.io/lodestar/getting-started/installation/#docker-installation) to install Lodestar.
- Quickly try out the whole stack by [starting a local testnet](https://chainsafe.github.io/lodestar/advanced-topics/setting-up-a-testnet).

## Light-Client CLI Example

It is possible to start up the light-client as a standalone process.

```bash
lodestar lightclient \
    --network mainnet \
    --beacon-api-url https://beacon-node.your-domain.com \
    --checkpoint-root "0xccaff4b99986a7b05e06738f1828a32e40799b277fd9f9ff069be55341fe0229"
```

## Light-Client Programmatic Example

For this example we will assume there is a running beacon node at `https://beacon-node.your-domain.com`

```ts
import type {Api} from "@lodestar/api/beacon";
import {ApiError} from "@lodestar/api";
import type {Bytes32} from "@lodestar/types";
import {createChainForkConfig} from "@lodestar/config";
import {networksChainConfig} from "@lodestar/config/networks";
import {
    type GenesisData,
    Lightclient,
    LightclientEvent,
    RunStatusCode
} from "@lodestar/light-client";
import {getClient} from "@lodestar/api";
import {LightClientRestTransport} from "@lodestar/light-client/transport";
import {getLcLoggerConsole} from "@lodestar/light-client/utils";

async function getGenesisData(api: Pick<Api, "beacon">): Promise<GenesisData> {
    const res = await api.beacon.getGenesis();
    ApiError.assert(res);

    return {
        genesisTime: Number(res.response.data.genesisTime),
        genesisValidatorsRoot: res.response.data.genesisValidatorsRoot,
    };
}

async function getSyncCheckpoint(api: Pick<Api, "beacon">): Promise<Bytes32> {
    const res = await api.beacon.getStateFinalityCheckpoints("head");
    ApiError.assert(res);
    return res.response.data.finalized.root;
}

const config = createChainForkConfig(networksChainConfig.mainnet);

const logger = getLcLoggerConsole({logDebug: Boolean(process.env.DEBUG)});

const api = getClient({urls: ["https://beacon-node.your-domain.com"]}, {config});

const transport = new LightClientRestTransport(api);

const lightclient = await Lightclient.initializeFromCheckpointRoot({
    config,
    logger,
    transport,
    genesisData: await getGenesisData(api),
    checkpointRoot: await getSyncCheckpoint(api),
    opts: {
        allowForcedUpdates: true,
        updateHeadersOnForcedUpdate: true,
    }
});

// Wait for the lightclient to start
await new Promise<void>((resolve) => {
    const lightclientStarted = (status: RunStatusCode): void => {
        if (status === RunStatusCode.started) {
            lightclient?.emitter.off(LightclientEvent.statusChange, lightclientStarted);
            resolve();
        }
    };
    lightclient?.emitter.on(LightclientEvent.statusChange, lightclientStarted);
    logger.info("Initiating lightclient");
    lightclient?.start();
});

logger.info("Lightclient synced");

lightclient.emitter.on(LightclientEvent.lightClientFinalityHeader, async (finalityUpdate) => {
    console.log(finalityUpdate);
});

lightclient.emitter.on(LightclientEvent.lightClientOptimisticHeader, async (optimisticUpdate) => {
    console.log(optimisticUpdate);
});
```

## Contributors

Read our [contribution documentation](https://chainsafe.github.io/lodestar/contribution/getting-started), [submit an issue](https://github.com/ChainSafe/lodestar/issues/new/choose) or talk to us on our [discord](https://discord.gg/yjyvFRP)!

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
