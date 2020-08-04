
# Lodestar CLI Documentation
This reference describes the syntax of the Lodestar CLI options and commands.


## Global Options

| Name | Type | Description | Default |
| ----------- | ----------- | ----------- | ----------- |
| rootDir | string | Lodestar root directory |  |
| testnet | string | Use a testnet configuration |  |
| preset | string | Specifies the default eth2 spec type | mainnet |
| paramsFile | string | Network configuration file |  |



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

#### account validator create options
| Name | Type | Description |
| ----------- | ----------- | ----------- |
| name | string | Use the wallet identified by this name | 
| passphraseFile | string | A path to a file containing the password which will unlock the wallet. | 
| depositGwei | string | The GWEI value of the deposit amount. Defaults to the minimum amount required for an active validator (MAX_EFFECTIVE_BALANCE) | 
| storeWithdrawalKeystore | boolean | If present, the withdrawal keystore will be stored alongside the voting keypair. It is generally recommended to *not* store the withdrawal key and instead generate them from the wallet seed when required. | 
| count | number | The number of validators to create | 

#### account validator deposit options
| Name | Type | Description |
| ----------- | ----------- | ----------- |
| validator | string | The name of the validator directory in $keystoresDir for which to deposit.     Set to 'all' to deposit all validators in the $keystoresDir. | 
| keystorePath | string | Path to a keystore with an Eth1 account. Must provide its password with keystorePassword | 
| keystorePassword | string | Password to unlock the Eth1 keystore in keystorePath | 
| rpcUrl | string | URL to an Eth1 JSON-RPC endpoint. It can have an unlocked account to sign,     use rpcPassword to unlock it, or provide a local keystore and password. | 
| rpcPassword | string | Password to unlock an Eth1 node's account provided with rpcUrl. | 
| ipcPath | string | Path to an Eth1 node IPC. | 

#### account validator import options
| Name | Type | Description |
| ----------- | ----------- | ----------- |
| keystore | string | Path to a single keystore to be imported. | 
| directory | string | Path to a directory which contains zero or more keystores for import. This directory and all sub-directories will be searched and any file name which contains 'keystore' and has the '.json' extension will be attempted to be imported. | 

#### account validator list options
N/A

### account wallet <command> options
| Name | Type | Description |
| ----------- | ----------- | ----------- |
| walletsDir | string | Directory for storing wallets. | 

#### account wallet create options
| Name | Type | Description |
| ----------- | ----------- | ----------- |
| name | string | The wallet will be created with this name. It is not allowed to create two wallets with the same name for the same --base-dir. | 
| passphraseFile | string | A path to a file containing the password which will unlock the wallet. If the file does not exist, a random password will be generated and saved at that path. To avoid confusion, if the file does not already exist it must include a '.pass' suffix. | 
| type | string | The type of wallet to create. Only HD (hierarchical-deterministic) wallets are supported presently. | 
| mnemonicOutputPath | string | If present, the mnemonic will be saved to this file | 

#### account wallet list options
N/A

## Beacon
### Usage
| Command | Description |
| - | - |
| init | Initialize lodestar | 
| beacon | Run a beacon node | 

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
| genesisStateFile | string | Genesis state in ssz-encoded format | 
| beaconDir | string | Beacon root dir | 
| dbDir | string | Beacon DB dir | 
| configFile | string | Beacon node configuration file | 
| peerIdFile | string | Peer ID file | 
| enrFile | string | ENR file | 
| logFile | string | Log file | 



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

