# Amphora M2

### Clone

To execution clients wanting to test against lodestar:

```
git clone --depth 1 http://github.com/chainsafe/lodestar && cd lodestar
```

### Setup data

**MUST UPDATE EXECUTION BLOCK HASH**

- Update `genesisEth1Hash` property in `amphora/m2/rcconfig.yml`
- Update `eth1.providerUrls` and `execution.urls` in `amphora/m2/rcconfig.yml` to your execution client ports

### Run

```
docker-compose -f amphora/docker-compose.devnet.yml up
```

Alternatively, to run from source:

```
yarn && yarn build
LODESTAR_PRESET=minimal ./lodestar dev --rcConfig amphora/devnet.rcconfig.yml
```

By default, info-level logs will be printed to stdout, debug logs will be stored in a docker volume.
