# Amphora hacknet V2

```
git clone -b merge-interop --depth 1 http://github.com/chainsafe/lodestar
cd lodestar
yarn && yarn build
curl "https://raw.githubusercontent.com/ChainSafe/hacknet/main/v2/beaconspec/genesis.ssz" -o amphora/v2/genesis.ssz
amphora/v2/run.sh
```
