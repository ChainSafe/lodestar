
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

