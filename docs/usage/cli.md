
# Lodestar CLI Documentation
This reference describes the syntax of the Lodestar CLI options and commands.

## Global Options

| Name | Type | Description | Default |
| ----------- | ----------- | ----------- | ----------- |
| rootDir | string | Lodestar root directory | ./.lodestar |
| preset | string | Specifies the default eth2 spec type | mainnet |


## Account
### Usage
| Command | Description |
| - | - |
| account <command>,am,a | Utilities for generating and managing Ethereum 2.0 accounts | 
| wallet <command> | Provides commands for managing Eth2 wallets. | 
| validator <command> | Provides commands for managing Eth2 validators. | 

### account validator <command> options
| Name | Type | Description |
| ----------- | ----------- | ----------- |
| keystoresDir | string | Directory for storing validator keystores. | 
| secretsDir | string | Directory for storing validator keystore secrets. | 

### account wallet <command> options
| Name | Type | Description |
| ----------- | ----------- | ----------- |
| walletsDir | string | Directory for storing wallets. | 


## Beacon
### Usage
| Command | Description |
| - | - |
| beacon <command> | Beacon node | 
| init | Initialize lodestar beacon node | 
| run | Run a lodestar beacon node | 

### Options
| Name | Type | Description |
| ----------- | ----------- | ----------- |
| api.rest.api | array | undefined | 
| api.rest.cors | string | undefined | 
| api.rest.enabled | boolean | undefined | 
| api.rest.host | string | undefined | 
| api.rest.port | number | undefined | 
| eth1.enabled | boolean | Whether to follow the eth1 chain | 
| eth1.provider.url | string | Url to Eth1 node with enabled rpc | 
| eth1.provider.network | number | Eth1 network id | 
| eth1.depositContract.deployedAt | number | Block number at which the deposit contract contract was deployed | 
| eth1.depositContract.address | string | Address of deposit contract | 
| logger.chain.level | string | undefined | 
| logger.db.level | string | undefined | 
| logger.eth1.level | string | undefined | 
| logger.node.level | string | undefined | 
| logger.network.level | string | undefined | 
| logger.sync.level | string | undefined | 
| logger.api.level | string | undefined | 
| logger.metrics.level | string | undefined | 
| logger.chores.level | string | undefined | 
| metrics.enabled | boolean | undefined | 
| metrics.gatewayUrl | string | undefined | 
| metrics.pushGateway | boolean | undefined | 
| metrics.serverPort | number | undefined | 
| metrics.timeout | number | undefined | 
| network.discv5.enabled | boolean | undefined | 
| network.discv5.bindAddr | string | undefined | 
| network.discv5.bootEnrs | array | undefined | 
| network.maxPeers | number | undefined | 
| network.bootnodes | array | undefined | 
| network.multiaddrs | array | undefined | 
| params.MAX_COMMITTEES_PER_SLOT | string | undefined | 
| params.TARGET_COMMITTEE_SIZE | string | undefined | 
| params.MAX_VALIDATORS_PER_COMMITTEE | string | undefined | 
| params.MIN_PER_EPOCH_CHURN_LIMIT | string | undefined | 
| params.SHUFFLE_ROUND_COUNT | string | undefined | 
| params.CHURN_LIMIT_QUOTIENT | string | undefined | 
| params.MIN_GENESIS_TIME | string | undefined | 
| params.HYSTERESIS_QUOTIENT | string | undefined | 
| params.HYSTERESIS_DOWNWARD_MULTIPLIER | string | undefined | 
| params.HYSTERESIS_UPWARD_MULTIPLIER | string | undefined | 
| params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT | string | undefined | 
| params.SAFE_SLOTS_TO_UPDATE_JUSTIFIED | string | undefined | 
| params.ETH1_FOLLOW_DISTANCE | string | undefined | 
| params.TARGET_AGGREGATORS_PER_COMMITTEE | string | undefined | 
| params.RANDOM_SUBNETS_PER_VALIDATOR | string | undefined | 
| params.EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION | string | undefined | 
| params.SECONDS_PER_ETH1_BLOCK | string | undefined | 
| params.DEPOSIT_CONTRACT_ADDRESS | string | undefined | 
| params.MIN_DEPOSIT_AMOUNT | string | undefined | 
| params.MAX_EFFECTIVE_BALANCE | string | undefined | 
| params.EJECTION_BALANCE | string | undefined | 
| params.EFFECTIVE_BALANCE_INCREMENT | string | undefined | 
| params.GENESIS_FORK_VERSION | string | undefined | 
| params.BLS_WITHDRAWAL_PREFIX | string | undefined | 
| params.GENESIS_DELAY | string | undefined | 
| params.SECONDS_PER_SLOT | string | undefined | 
| params.MIN_ATTESTATION_INCLUSION_DELAY | string | undefined | 
| params.SLOTS_PER_EPOCH | string | undefined | 
| params.MIN_SEED_LOOKAHEAD | string | undefined | 
| params.MAX_SEED_LOOKAHEAD | string | undefined | 
| params.EPOCHS_PER_ETH1_VOTING_PERIOD | string | undefined | 
| params.SLOTS_PER_HISTORICAL_ROOT | string | undefined | 
| params.MIN_VALIDATOR_WITHDRAWABILITY_DELAY | string | undefined | 
| params.SHARD_COMMITTEE_PERIOD | string | undefined | 
| params.MAX_EPOCHS_PER_CROSSLINK | string | undefined | 
| params.MIN_EPOCHS_TO_INACTIVITY_PENALTY | string | undefined | 
| params.EPOCHS_PER_HISTORICAL_VECTOR | string | undefined | 
| params.EPOCHS_PER_SLASHINGS_VECTOR | string | undefined | 
| params.HISTORICAL_ROOTS_LIMIT | string | undefined | 
| params.VALIDATOR_REGISTRY_LIMIT | string | undefined | 
| params.BASE_REWARD_FACTOR | string | undefined | 
| params.WHISTLEBLOWER_REWARD_QUOTIENT | string | undefined | 
| params.PROPOSER_REWARD_QUOTIENT | string | undefined | 
| params.INACTIVITY_PENALTY_QUOTIENT | string | undefined | 
| params.MIN_SLASHING_PENALTY_QUOTIENT | string | undefined | 
| params.MAX_PROPOSER_SLASHINGS | string | undefined | 
| params.MAX_ATTESTER_SLASHINGS | string | undefined | 
| params.MAX_ATTESTATIONS | string | undefined | 
| params.MAX_DEPOSITS | string | undefined | 
| params.MAX_VOLUNTARY_EXITS | string | undefined | 
| params.DOMAIN_BEACON_PROPOSER | string | undefined | 
| params.DOMAIN_BEACON_ATTESTER | string | undefined | 
| params.DOMAIN_RANDAO | string | undefined | 
| params.DOMAIN_DEPOSIT | string | undefined | 
| params.DOMAIN_VOLUNTARY_EXIT | string | undefined | 
| params.DOMAIN_SELECTION_PROOF | string | undefined | 
| params.DOMAIN_AGGREGATE_AND_PROOF | string | undefined | 
| templateConfigFile | string | Template configuration used to initialize beacon node | 
| genesisStateFile | string | Genesis state in ssz-encoded format | 
| testnet | string | Use a testnet configuration and genesis file | 
| beaconDir | string | Beacon root dir | 
| dbDir | string | Beacon DB dir | 
| configFile | string | Beacon node configuration file | 
| peerIdFile | string | Peer ID file | 
| enrFile | string | ENR file | 


## Validator
### Usage
| Command | Description |
| - | - |
| validator | Run one or multiple validator clients | 

### Options
| Name | Type | Description |
| ----------- | ----------- | ----------- |
| keystoresDir | string | Directory for storing validator keystores. | 
| secretsDir | string | Directory for storing validator keystore secrets. | 
| validatorsDbDir | string | Data directory for validator databases. | 
| server | string | Address to connect to BeaconNode | 
| force | boolean | Open validators even if there's a lockfile. Use with caution | 

