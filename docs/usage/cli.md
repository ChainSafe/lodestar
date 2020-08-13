
# Lodestar CLI Documentation
This reference describes the syntax of the Lodestar CLI options and commands.

## Global Options
| Name | Type | Description | Default |
| ----------- | ----------- | ----------- | ----------- |
| rootDir | string | Lodestar root directory |  |
| testnet | string | Use a testnet configuration |  |
| preset | string | Specifies the default eth2 spec type | mainnet |
| paramsFile | string | Network configuration file |  |


## `beacon`
Run a beacon node
### `beacon` options
These are the beacon command options
| Name | Type | Description |
| ----------- | ----------- | ----------- |
| configFile | string | Beacon node configuration file |
| logFile | string | Log file |
| genesisStateFile | string | Genesis state in ssz-encoded format |
| api.rest.api | array | Pick namespaces to expose for HTTP API |
| api.rest.cors | string | Configures the Access-Control-Allow-Origin CORS header for HTTP API |
| api.rest.enabled | boolean | Enable/disable HTTP API |
| api.rest.host | string | Set host for HTTP API |
| api.rest.port | number | Set port for HTTP API |
| eth1.enabled | boolean | Whether to follow the eth1 chain |
| eth1.provider.url | string | Url to Eth1 node with enabled rpc |
| eth1.depositContract.deployedAt | number | Block number at which the deposit contract contract was deployed |
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
| sync.minPeers | number | undefined |
| enr.ip | string | Override ENR IP entry |
| enr.tcp | number | Override ENR TCP entry |
| enr.udp | number | Override ENR UDP entry |
| enr.ip6 | string | Override ENR IPv6 entry |
| enr.tcp6 | number | Override ENR (IPv6-specific) TCP entry |
| enr.udp6 | number | Override ENR (IPv6-specific) UDP entry |
## `validator`
Run one or multiple validator clients
### `validator` options
These are the validator command options
| Name | Type | Description |
| ----------- | ----------- | ----------- |
| keystoresDir | string | Directory for storing validator keystores. |
| secretsDir | string | Directory for storing validator keystore secrets. |
| validatorsDbDir | string | Data directory for validator databases. |
| server | string | Address to connect to BeaconNode |
| force | boolean | Open validators even if there's a lockfile. Use with caution |
| graffiti | string | Specify your custom graffiti to be included in blocks (plain UTF8 text, 32 characters max) |
## `account `
Utilities for generating and managing Ethereum 2.0 accounts
### `account  validator `
Provides commands for managing Eth2 validators.
#### `account  validator ` options
These are the account  validator  command options
| Name | Type | Description |
| ----------- | ----------- | ----------- |
| keystoresDir | string | Directory for storing validator keystores. |
| secretsDir | string | Directory for storing validator keystore secrets. |
#### `account  validator  create`
Creates new validators from an existing EIP-2386 wallet using the EIP-2333 HD key derivation scheme. Creates a new directory per validator with a voting keystore, withdrawal keystore, and pre-computed deposit RPL data
##### `account  validator  create` options
These are the account  validator  create command options
| Name | Type | Description |
| ----------- | ----------- | ----------- |
| name | string | Use the wallet identified by this name |
| passphraseFile | string | A path to a file containing the password which will unlock the wallet. |
| depositGwei | string | The GWEI value of the deposit amount. Defaults to the minimum amount   required for an active validator (MAX_EFFECTIVE_BALANCE) |
| storeWithdrawalKeystore | boolean | If present, the withdrawal keystore will be stored alongside the voting   keypair. It is generally recommended to *not* store the withdrawal key and   instead generate them from the wallet seed when required. |
| count | number | The number of validators to create |
#### `account  validator  deposit`
Submits a deposit to an Eth1 validator registration contract via an IPC endpoint of an Eth1 client (e.g., Geth, OpenEthereum, etc.). The validators must already have been created and exist on the file-system. The process will exit immediately with an error if any error occurs. After each deposit is submitted to the Eth1 node, a file will be saved in the validator directory with the transaction hash. The deposit contract address will be determined by the spec config flag.
##### `account  validator  deposit` options
These are the account  validator  deposit command options
| Name | Type | Description |
| ----------- | ----------- | ----------- |
| validator | string | The name of the validator directory in $keystoresDir for which to deposit.       Set to 'all' to deposit all validators in the $keystoresDir. |
| keystorePath | string | Path to a keystore with an Eth1 account. Must provide its password with keystorePassword |
| keystorePassword | string | Password to unlock the Eth1 keystore in keystorePath |
| rpcUrl | string | URL to an Eth1 JSON-RPC endpoint. It can have an unlocked account to sign,       use rpcPassword to unlock it, or provide a local keystore and password. |
| rpcPassword | string | Password to unlock an Eth1 node's account provided with rpcUrl. |
| ipcPath | string | Path to an Eth1 node IPC. |
#### `account  validator  import`
Imports one or more EIP-2335 keystores into a Lodestar validator client directory, requesting passwords interactively. The directory flag provides a convenient method for importing a directory of keys generated by the eth2-deposit-cli Ethereum Foundation utility.
##### `account  validator  import` options
These are the account  validator  import command options
| Name | Type | Description |
| ----------- | ----------- | ----------- |
| keystore | string | Path to a single keystore to be imported. |
| directory | string | Path to a directory which contains zero or more keystores for import. This directory and all sub-directories will be searched and any file name which contains 'keystore' and has the '.json' extension will be attempted to be imported. |
#### `account  validator  list`
Lists the public keys of all validators

### `account  wallet `
Provides commands for managing Eth2 wallets.
#### `account  wallet ` options
These are the account  wallet  command options
| Name | Type | Description |
| ----------- | ----------- | ----------- |
| walletsDir | string | Directory for storing wallets. |
#### `account  wallet  create`
Creates a new HD (hierarchical-deterministic) EIP-2386 wallet
##### `account  wallet  create` options
These are the account  wallet  create command options
| Name | Type | Description |
| ----------- | ----------- | ----------- |
| name | string | The wallet will be created with this name. It is not allowed to   create two wallets with the same name for the same --base-dir. |
| passphraseFile | string | A path to a file containing the password which will unlock the wallet.   If the file does not exist, a random password will be generated and saved at that   path. To avoid confusion, if the file does not already exist it must include a   '.pass' suffix. |
| type | string | The type of wallet to create. Only HD (hierarchical-deterministic)
  wallets are supported presently. |
| mnemonicOutputPath | string | If present, the mnemonic will be saved to this file |
#### `account  wallet  list`
Lists the names of all wallets

## `init`
Initialize lodestar
### `init` options
These are the init command options
| Name | Type | Description |
| ----------- | ----------- | ----------- |
| configFile | string | Beacon node configuration file |
| logFile | string | Log file |
| genesisStateFile | string | Genesis state in ssz-encoded format |
| api.rest.api | array | Pick namespaces to expose for HTTP API |
| api.rest.cors | string | Configures the Access-Control-Allow-Origin CORS header for HTTP API |
| api.rest.enabled | boolean | Enable/disable HTTP API |
| api.rest.host | string | Set host for HTTP API |
| api.rest.port | number | Set port for HTTP API |
| eth1.enabled | boolean | Whether to follow the eth1 chain |
| eth1.provider.url | string | Url to Eth1 node with enabled rpc |
| eth1.depositContract.deployedAt | number | Block number at which the deposit contract contract was deployed |
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
| sync.minPeers | number | undefined |
| enr.ip | string | Override ENR IP entry |
| enr.tcp | number | Override ENR TCP entry |
| enr.udp | number | Override ENR UDP entry |
| enr.ip6 | string | Override ENR IPv6 entry |
| enr.tcp6 | number | Override ENR (IPv6-specific) TCP entry |
| enr.udp6 | number | Override ENR (IPv6-specific) UDP entry |
## `dev`
Command used to quickly bootstrap beacon node and validators
### `dev` options
These are the dev command options
| Name | Type | Description |
| ----------- | ----------- | ----------- |
| configFile | string | Beacon node configuration file |
| logFile | string | Log file |
| genesisStateFile | string | Genesis state in ssz-encoded format |
| api.rest.api | array | Pick namespaces to expose for HTTP API |
| api.rest.cors | string | Configures the Access-Control-Allow-Origin CORS header for HTTP API |
| api.rest.enabled | boolean | Enable/disable HTTP API |
| api.rest.host | string | Set host for HTTP API |
| api.rest.port | number | Set port for HTTP API |
| eth1.enabled | boolean | Whether to follow the eth1 chain |
| eth1.provider.url | string | Url to Eth1 node with enabled rpc |
| eth1.depositContract.deployedAt | number | Block number at which the deposit contract contract was deployed |
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
| sync.minPeers | number | undefined |
| enr.ip | string | Override ENR IP entry |
| enr.tcp | number | Override ENR TCP entry |
| enr.udp | number | Override ENR UDP entry |
| enr.ip6 | string | Override ENR IPv6 entry |
| enr.tcp6 | number | Override ENR (IPv6-specific) TCP entry |
| enr.udp6 | number | Override ENR (IPv6-specific) UDP entry |
| preset | string | Specifies the default eth2 spec type |
| genesisValidators | number | If present it will create genesis with interop validators and start chain. |
| startValidators | string | Start interop validators in given range |
| reset | boolean | To delete chain and validator directories |
| server | string | Address to connect to BeaconNode. Pass 'memory' for in memory communication |
