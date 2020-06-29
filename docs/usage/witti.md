# Connect to Witti testnet

Running a Lodestar node on the [Witti](https://github.com/goerli/witti) multi-client testnet only requires basic familiarity with the terminal.

Make sure lodestar in installed in your local environment. The following command should return a non error message. If it fails, go the [install guide](/install) and make sure Lodestar is available in your environment.

```
yarn run cli --help
```

## Initialize beacon configuration

To simplify the initial configuration, copy the following config template into a file named `witti.json`. There should be a copy shortcut at the top-right corner of the code box below.

```json
{
  "api": {
    "enabled": true,
    "namespaces": ["beacon", "validator"],
    "host": "127.0.0.1",
    "port": 9596,
    "cors": {
      "origin": "*"
    }
  },
  "chain": {
    "preset": "mainnet",
    "genesisStateFile": "genesis.ssz",
    "params": {}
  },
  "eth1": {
    "enabled": false,
    "provider": {
      "url": "http://127.0.0.1:8545",
      "network": 5
    },
    "depositContract": {
      "deployedAt": 2758066,
      "address": "0x42cc0FcEB02015F145105Cf6f19F90e9BEa76558"
    }
  },
  "metrics": {
    "enabled": true,
    "serverPort": 5000
  },
  "network": {
    "discv5": {
      "enabled": true,
      "bindAddr": "/ip4/0.0.0.0/udp/9000",
      "bootEnrs": [
        "enr:-Ku4QJsxkOibTc9FXfBWYmcdMAGwH4bnOOFb4BlTHfMdx_f0WN-u4IUqZcQVP9iuEyoxipFs7-Qd_rH_0HfyOQitc7IBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD1pf1CAAAAAP__________gmlkgnY0gmlwhLAJM9iJc2VjcDI1NmsxoQL2RyM26TKZzqnUsyycHQB4jnyg6Wi79rwLXtaZXty06YN1ZHCCW8w",
        "enr:-LK4QKTkBk3I1y4__nfX18Jdhcko2ExQzqpr8byjTB7t8HVFTLKNvipBZbPItODKWFdhBVN8vVh89ScZPdSTNoiLXXoBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD2d10HAAABE___________gmlkgnY0gmlwhLAJM9iJc2VjcDI1NmsxoQICvB04SDhZK46nvJmm6GZvo8RsKctq4uWK6jQRZBxewoN0Y3CCIyiDdWRwgiMo",
        "enr:-LK4QO-InqtcvYyJysIC8m-GimjQxeh2fMYNg557rfLD3iOtK5rZo6-1N09tw0NeIt4ht2rLtCNS6NGwU38qarXaVUMBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD2d10HAAABE___________gmlkgnY0gmlwhLAJM9iJc2VjcDI1NmsxoQISU9N1Kj03Z-IBVlevP56X9qkZxA1fv62TLRKlfzI1LYN0Y3CCMsiDdWRwgi7g",
        "enr:-KG4QOWbLS8XipfTFUjjaboBG8F4fkw7YtSSvvenmlGz6z8LeknOAxokwlhQWwiV3AftLgreD8hC94EnXdYzw93aVdQDhGV0aDKQ9nddBwAAARP__________4JpZIJ2NIJpcISwCTPYiXNlY3AyNTZrMaECLYJchUH6A-oyZenBKm5hLwIDy6xZqksxOt24irvEOEuDdGNwgnUwg3VkcIJ1MA"
      ]
    },
    "maxPeers": 25,
    "bootMultiaddrs": [],
    "localMultiaddrs": ["/ip4/0.0.0.0/tcp/30607"]
  }
}
```

Eth1 genesis state processing is currently slow, its best to start from known genesis state and disable eth1 processing. First, download a genesis file locally with the command below or from this [link](https://github.com/goerli/witti/blob/master/lighthouse/genesis.ssz).

```bash
wget https://github.com/goerli/witti/raw/master/lighthouse/genesis.ssz
```

Make sure that the downloaded genesis file is at the expected path and matches the path in the command below.

We recommend initializing lodestar into a specific directory, which is helpful for running multiple nodes. Declare a root dir so all data will be installed/fetched by either:

- set `root-dir` cli flag or
- set `LODESTAR_ROOT_DIR` env variable

<!-- prettier-ignore-start -->
!!! info
    All paths are relative to the working directory when running `lodestar`
<!-- prettier-ignore-end -->

To initialize the Lodestar configuration, run the command:

```bash
yarn run cli beacon init \
    --eth1.enabled=false \
    --chain.genesisStateFile=genesis.ssz \
    --template-config-file witti.json \
    --root-dir .witti
```

As a result, new files should had been created in `.witti/beacon` with a directory structure similar to:

```bash
.witti/
└── beacon
    ├── beacon.config.json
    ├── chain-db/
    ├── enr.json
    └── peer-id.json
```

## Run a beacon node

To start a Lodestar beacon run the command:

```bash
yarn run cli beacon run \
    --root-dir .witti
```

Immediatelly you should see confirmation that the different modules have started

```bash
2020-06-21 17:34:24  [CHAIN]            info: Initializing beacon chain with state root 0x773c694b47504d789dc768d2356f691866b47833d0d85e02511d7cd339925b17 and genesis block root 0x19aa2deaa02cac9774eb8948a8ead1ebe851ba9590878a10cd5767092e16ba12
2020-06-21 17:34:25  [CHAIN]            info: Beacon chain initialized
2020-06-21 17:34:25  [NODE]             info: Starting eth2 beacon node - LODESTAR!
2020-06-21 17:34:25  [METRICS]          info: Starting metrics HTTP server on port 5000
2020-06-21 17:34:25  [DB]               info: Connected to LevelDB database at .witti/beacon/chain-db
2020-06-21 17:34:26  [CHAIN]            info: Chain started, waiting blocks and attestations
```

After finding some peers the chain should start processing blocks up to the current head

```
2020-06-21 17:35:31  [CHAIN]            info: Processed new chain head newChainHeadRoot=0x993d99d17c176263f246c96a232bd96d847543d7c90cc60ddc559edcab99b2e6, slot=111, epoch=3
2020-06-21 17:35:31  [CHAIN]            info: Processed new chain head newChainHeadRoot=0xcc1eb4c83cb0d9a9f7ed0045d2cd6257aadd226420baabd3d672be35605fe470, slot=112, epoch=3
2020-06-21 17:35:31  [CHAIN]            info: Processed new chain head newChainHeadRoot=0xb5c7b08a369c0943292a91e733f3feed184bc3c0b49d04878bc86e0705c15fe8, slot=113, epoch=3
```

<!-- prettier-ignore-start -->
!!! info
    If your node is stuck with `Current peerCount=0` review your network configuration to make sure your ports are open.
<!-- prettier-ignore-end -->

A young testnet (such as Witti) should take a few hours to sync. If you see multiple or consistent errors in the logs, please open a [Github issue](https://github.com/ChainSafe/lodestar/issues/new) or reach out to us in [Discord](https://discord.gg/yjyvFRP). Just by reporting anomalities you are helping accelerate the progress of Eth2.0, thanks for contributing!

## Run a validator

_TBD_

## Submit your deposit to Goerli

_TBD_
