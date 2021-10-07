# Amphora hacknet V2

**Terminal 1 - Lodestar**

**Setup**

```
git clone -b merge-interop --depth 1 http://github.com/chainsafe/lodestar
cd lodestar
yarn
```

_Get genesis (not committed)_

```
curl "https://raw.githubusercontent.com/ChainSafe/hacknet/main/v2/beaconspec/genesis.ssz" -o amphora/v2/genesis.ssz
```

**On setup + after changes**

```
yarn build
```

**Run**

_works being ran from any directory_

```
amphora/v2/run.sh
```

**Terminal 2 - Execution**

**Geth**

```
amphora/v2/run_geth.sh
```
