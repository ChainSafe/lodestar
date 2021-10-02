# Amphora README

To execution clients wanting to test against lodestar:

`git clone http://github.com/chainsafe/lodestar && cd lodestar`
`docker-compose -f amphora/docker-compose.devnet.yml up`

By default, info-level logs will be printed to stdout, debug logs will be stored in a docker volume.

Relevant options to configure:
`--params.MERGE_FORK_EPOCH` - set to > 0 to set a merge fork post-genesis
`--params.TRANSITION_TOTAL_DIFFICULTY` - set to configure the total difficulty that triggers the merge transition
`--execution.urls` - set to change the host/port used to connect to the execution client
