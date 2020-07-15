# Connect to Altona testnet

Running a Lodestar node on the [Altona](https://github.com/goerli/altona) multi-client testnet only requires basic familiarity with the terminal.

Make sure lodestar is installed in your local environment. The following command should return a non error message. If it fails, go the [install guide](/install) and make sure Lodestar is available in your environment.

```
yarn run cli --help
```

## Initialize beacon configuration

To simplify the initial configuration, copy the following config template into a file named `altona.json`. There should be a copy shortcut at the top-right corner of the code box below.

```json
{
  "api": {
    "enabled": true,
    "namespaces": [
      "beacon",
      "validator"
    ],
    "host": "127.0.0.1",
    "port": 9596,
    "cors": {
      "origin": "*"
    }
  },
  "chain": {
    "preset": "mainnet",
    "genesisStateFile": ".altona/beacon/genesis.ssz",
    "params": {
        "MIN_GENESIS_TIME": 1593433800,
        "MIN_GENESIS_ACTIVE_VALIDATOR_COUNT": 640,
        "GENESIS_DELAY": 172800, 
        "GENESIS_FORK_VERSION": "0x00000121"
    }
  },
  "eth1": {
    "enabled": false,
    "provider": {
      "url": "http://goerli.prylabs.net",
      "network": 5
    },
    "depositContract": {
      "deployedAt": 2917810,
      "address": "0x16e82D77882A663454Ef92806b7DeCa1D394810f"
    }
  },
  "logger": {
    "chain": {
      "level": "verbose"
    },
    "network": {
      "level": "verbose"
    },
    "eth1": {
      "level": "verbose"
    },
    "sync": {
      "level": "verbose"
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
        "enr:-LK4QFtV7Pz4reD5a7cpfi1z6yPrZ2I9eMMU5mGQpFXLnLoKZW8TXvVubShzLLpsEj6aayvVO1vFx-MApijD3HLPhlECh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD6etXjAAABIf__________gmlkgnY0gmlwhDMPYfCJc2VjcDI1NmsxoQIerw_qBc9apYfZqo2awiwS930_vvmGnW2psuHsTzrJ8YN0Y3CCIyiDdWRwgiMo",
        "enr:-LK4QPVkFd_MKzdW0219doTZryq40tTe8rwWYO75KDmeZM78fBskGsfCuAww9t8y3u0Q0FlhXOhjE1CWpx3SGbUaU80Ch2F0dG5ldHOIAAAAAAAAAACEZXRoMpD6etXjAAABIf__________gmlkgnY0gmlwhDMPRgeJc2VjcDI1NmsxoQNHu-QfNgzl8VxbMiPgv6wgAljojnqAOrN18tzJMuN8oYN0Y3CCIyiDdWRwgiMo",
        "enr:-LK4QHe52XPPrcv6-MvcmN5GqDe_sgCwo24n_2hedlfwD_oxNt7cXL3tXJ7h9aYv6CTS1C_H2G2_dkeqm_LBO9nrpiYBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD9yjmwAAABIf__________gmlkgnY0gmlwhANzD9uJc2VjcDI1NmsxoQJX7zMnRU3szfGfS8MAIfPaQKOBpu3sBVTXf4Qq0b_m-4N0Y3CCIyiDdWRwgiMo",
        "enr:-LK4QLkbbq7xuRa_EnWd_kc0TkQk0pd0B0cZYR5LvBsncFQBDyPbGdy8d24TzRVeK7ZWwM5_2EcSJK223f8TYUOQYfwBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD9yjmwAAABIf__________gmlkgnY0gmlwhAPsjtOJc2VjcDI1NmsxoQJNw_aZgWXl2SstD--WAjooGudjWLjEbbCIddJuEPxzWYN0Y3CCIyiDdWRwgiMo",
        "enr:-LK4QHy-glnxN1WTk5f6d7-xXwy_UKJLs5k7p_S4KRY9I925KTzW_kQLjfFriIpH0de7kygBwrSl726ukq9_OG_sgKMCh2F0dG5ldHOIUjEAIQEAFMiEZXRoMpD9yjmwAAABIf__________gmlkgnY0gmlwhBLmhrCJc2VjcDI1NmsxoQNlU7gT0HUvpLA41n-P5GrCgjwMwtG02YsRRO0lAmpmBYN0Y3CCIyiDdWRwgiMo",
        "enr:-LK4QDz0n0vpyOpuStB8e22h9ayHVcvmN7o0trC7eC0DnZV9GYGzK5uKv7WlzpMQM2nDTG43DWvF_DZYwJOZCbF4iCQBh2F0dG5ldHOI__________-EZXRoMpD9yjmwAAABIf__________gmlkgnY0gmlwhBKN136Jc2VjcDI1NmsxoQP5gcOUcaruHuMuTv8ht7ZEawp3iih7CmeLqcoY1hxOnoN0Y3CCIyiDdWRwgiMo",
        "enr:-LK4QOScOZ35sOXEH6CEW15lfv7I3DhqQAzCPQ_nRav95otuSh4yi9ol0AruKDiIk9qqGXyD-wQDaBAPLhwl4t-rUSQBh2F0dG5ldHOI__________-EZXRoMpD9yjmwAAABIf__________gmlkgnY0gmlwhCL68KuJc2VjcDI1NmsxoQK5fYR3Ipoc01dz0d2-EcL7m26zKQSkAbf4rwcMMM09CoN0Y3CCIyiDdWRwgiMo",
        "enr:-Ku4QMqmWPFkgM58F16wxB50cqWDaWaIsyANHL8wUNSB4Cy1TP9__uJQNRODvx_dvO6rY-BT3psrYTMAaxnMGXb6DuoBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD1pf1CAAAAAP__________gmlkgnY0gmlwhBLf22SJc2VjcDI1NmsxoQNoed9JnQh7ltcAacHEGOjwocL1BhMQbYTgaPX0kFuXtIN1ZHCCE4g",
        "enr:-LK4QDHu6BtDKnGbthNp-GvweQlW0jiOX9KFCj5Ql9kScrFed76tgHlFv7A-9ZRB-EVZpKItvlNjo3yxjj7jYIZUJa4Bh2F0dG5ldHOIAAAAAAAAAACEZXRoMpAAAAAAAAAAAAAAAAAAAAAAgmlkgnY0gmlwhDbUyQKJc2VjcDI1NmsxoQLV6Yse8baXDFu9r_dvm9BVd2ni2-wwvANWA-4ewbhniIN0Y3CCIyiDdWRwgiMo",
        "enr:-LK4QF3lT3Ch8Ljyx-KwoPrvoJHO-HDd3jOREMIZCWzi_HkHFVub5qt52MliDTLDgpXMS9tBzzLI4ObT_Z2m2Kus9vMBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpAAAAAAAAAAAAAAAAAAAAAAgmlkgnY0gmlwhBKNqHeJc2VjcDI1NmsxoQOTO9uI9UZjuTOpcWvnCfhfQTmcMaIzBFsjMpXYnppET4N0Y3CCIyiDdWRwgiMo",
        "enr:-LK4QHdys8TViG_QtAVjTKaP92xlbD7eP_kdqQDGEOSTYh2sW_uN41AyS_cBWP1nM-Gi_cXYQ5_rjx-Qgn3dCDydi8MBh2F0dG5ldHOI__________-EZXRoMpD9yjmwAAABIf__________gmlkgnY0gmlwhDZdpaaJc2VjcDI1NmsxoQNX8JXYTfTkL1rZ9-4Dd9De-C9W7bwUlmwOEhSIa8jZ0YN0Y3CCI4yDdWRwgiOM---",
        "enr:-LK4QPM8lQwCtEFVqBnqHs6p_OE2WkDtcDh5gLriXMMSy-wnd8058swVyiUgANqFgbPdV6Pm5_LyeAIT6gKLBW70ia4Bh2F0dG5ldHOI__________-EZXRoMpD9yjmwAAABIf__________gmlkgnY0gmlwhBLCKTOJc2VjcDI1NmsxoQMQfjhh_GwSLRpPKweO79mo_n3sPaK75E11DbrM-8OaY4N0Y3CCI4yDdWRwgiOM---",
        "enr:-LK4QKFLQRdyIaxd8_eT0nD35ZU2JrRc6IcO347uURaVaZ7UbU3ts_jAaEt2krT5DyI9IQt5JECOTO7IpSPCZgeySwMBh2F0dG5ldHOI__________-EZXRoMpD9yjmwAAABIf__________gmlkgnY0gmlwhDZdfJeJc2VjcDI1NmsxoQNnAwjMpA-1zWgd4ogGmRqsM1x7y7EQGDw_XxRpoo7KFIN0Y3CCI4yDdWRwgiOM---",
        "enr:-LK4QOCodKmp5bsgQyl1nciqX7FGpsZdu0Mj1qFFpmw5BEdSOQ1xEwFlOuSkOVC4vHvbMNV5MPLkPvzw7xC42BvlMnEBh2F0dG5ldHOI__________-EZXRoMpD9yjmwAAABIf__________gmlkgnY0gmlwhBLEHx6Jc2VjcDI1NmsxoQLjYA6hPlO-7bzqsnT_NJRC0vjGTSQwyhlSqSVCdB0UcYN0Y3CCI4yDdWRwgiOM---"
      ]
    },
    "maxPeers": 25,
    "bootMultiaddrs": [
        "/ip4/51.15.97.240/tcp/9000/p2p/16Uiu2HAkwVT363kpFmupwJBH5tkhnaNZPQSY7zANnPGB63ikD1Wp",
"/ip4/51.15.70.7/tcp/9000/p2p/16Uiu2HAmHV1UA1SBnNK7Ztp8ACQ8DzHwNnR49VDEPBavCU33PtVE"
    ],
    "localMultiaddrs": [
      "/ip4/0.0.0.0/tcp/30607"
    ]
  }
}
```

Eth1 genesis state processing is currently slow, its best to start from known genesis state and disable eth1 processing. First, download a genesis file locally with the command below or from [altona/genesis.ssz](https://github.com/eth2-clients/eth2-testnets/blob/master/shared/altona/genesis.ssz).

```bash
wget https://github.com/eth2-clients/eth2-testnets/blob/master/shared/altona/genesis.ssz
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
    --template-config-file altona.json \
    --eth1.enabled=false \
    --chain.genesisStateFile=genesis.ssz \
    --root-dir .altona
```

As a result, new files should had been created in `.altona/beacon`. The CLI flags are used to tweak the configuration written to disk. The configuration should be available under `.altona/beacon/beacon.config.json`

```bash
.altona/
└── beacon
    ├── beacon.config.json
    ├── chain-db/
    ├── enr.json
    └── peer-id.json
```

## Run a beacon node

To start a Lodestar beacon run the command:

```bash
yarn run cli beacon run --root-dir .altona
```

Immediatelly you should see confirmation that the different modules have started

```bash
2020-06-21 17:34:24  [CHAIN]            info: Initializing beacon chain with state root 0x773c694b47504d789dc768d2356f691866b47833d0d85e02511d7cd339925b17 and genesis block root 0x19aa2deaa02cac9774eb8948a8ead1ebe851ba9590878a10cd5767092e16ba12
2020-06-21 17:34:25  [CHAIN]            info: Beacon chain initialized
2020-06-21 17:34:25  [NODE]             info: Starting eth2 beacon node - LODESTAR!
2020-06-21 17:34:25  [METRICS]          info: Starting metrics HTTP server on port 5000
2020-06-21 17:34:25  [DB]               info: Connected to LevelDB database at .altona/beacon/chain-db
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

A young testnet (such as Altona) should take a few hours to sync. If you see multiple or consistent errors in the logs, please open a [Github issue](https://github.com/ChainSafe/lodestar/issues/new) or reach out to us in [Discord](https://discord.gg/yjyvFRP). Just by reporting anomalities you are helping accelerate the progress of Eth2.0, thanks for contributing!

## Run a validator

_TBD_

## Submit your deposit to Goerli

_TBD_
