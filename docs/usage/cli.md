
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
| api.rest.api | array | Pick namespaces to expose for HTTP API | 
| api.rest.cors | string | Configures the Access-Control-Allow-Origin CORS header for HTTP API | 
| api.rest.enabled | boolean | Enable/disable HTTP API | 
| api.rest.host | string | Set host for HTTP API | 
| api.rest.port | number | Set port for HTTP API | 
| eth1.enabled | boolean | Whether to follow the eth1 chain | 
| eth1.provider.url | string | Url to Eth1 node with enabled rpc | 
| eth1.depositContract.deployedAt | number | Block number at which the deposit contract contract was deployed | 
| logger.chain.level | string | Logging verbosity level for chain | 
| logger.db.level | string | Logging verbosity level for db | 
| logger.eth1.level | string | Logging verbosity level for eth1 | 
| logger.node.level | string | Logging verbosity level for node | 
| logger.network.level | string | Logging verbosity level for network | 
| logger.sync.level | string | Logging verbosity level for sync | 
| logger.api.level | string | Logging verbosity level for api | 
| logger.metrics.level | string | Logging verbosity level for metrics | 
| logger.chores.level | string | Logging verbosity level for chores | 
| metrics.enabled | boolean | Enable metrics | 
| metrics.gatewayUrl | string | Gateway URL for metrics | 
| metrics.pushGateway | boolean | Enable/disable Prometheus Pushgateway for metrics | 
| metrics.serverPort | number | Server port for metrics | 
| metrics.timeout | number | How often metrics should be probed | 
| network.discv5.enabled | boolean | Enable discv5 | 
| network.discv5.bindAddr | string | Local multiaddress to listen on for discv5 | 
| network.discv5.bootEnrs | array | Bootnodes for discv5 discovery | 
| network.maxPeers | number | Maximum # of peers who can connect | 
| network.bootnodes | array | Libp2p peers to connect to on boot | 
| network.multiaddrs | array | Local listening addresses for req/resp and gossip | 
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
| graffiti | string | Specify your custom graffiti to be included in blocks (plain UTF8 text, 32 characters max) | 

