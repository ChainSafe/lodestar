# Amphora hacknet V1

```
git clone -b merge-interop --depth 1 http://github.com/chainsafe/lodestar
cd lodestar
yarn && yarn build
curl "https://raw.githubusercontent.com/ChainSafe/hacknet/main/v1/beaconspec/genesis.ssz" -o amphora/v1/genesis.ssz
amphora/v1/run.sh
```
