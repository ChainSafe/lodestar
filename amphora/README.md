# Amphora README

To execution clients wanting to test against lodestar:

- `git clone --depth 1 http://github.com/chainsafe/lodestar && cd lodestar`
- `docker-compose -f amphora/docker-compose.devnet.yml up`

Alternatively, to run from source:

- `git clone --depth 1 http://github.com/chainsafe/lodestar && cd lodestar`
- `yarn && yarn build`
- `./amphora/run-devnet.sh`

By default, info-level logs will be printed to stdout, debug logs will be stored in a docker volume.

Some relevant options you might configure

- edit amphora/devnet.rcconfig.yml
- `params.MERGE_FORK_EPOCH` - set to > 0 to set a merge fork post-genesis
- `params.TERMINAL_TOTAL_DIFFICULTY` - set to configure the total difficulty that triggers the merge transition
- `execution.urls` & `eth1.providerUrls` - set to change the host/port used to connect to the execution client
- `genesisEth1Hash` - set a genesis eth1 block hash (hex string) (useful for M2)
