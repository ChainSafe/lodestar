---
title: Starting a Validator Client
---

# Validator Configuration

The following instructions are for stakers utilizing the Lodestar validator client.

## Setup your validator

Validators are represented by a BLS keypair. Use your generated mnemonic from one of the tools above to generate the keystore files required for validator duties on Ethereum using the Lodestar validator client.

### Create a keystore

To create a keystore, we recommend using the official [Staking Deposit CLI](https://github.com/ethereum/staking-deposit-cli/releases) from the Ethereum Foundation for users comfortable with command line interfaces.

Alternatively, for a graphical user interface, you can use the [Stakehouse Wagyu Key Generator](https://wagyu.gg/) developed by members of the EthStaker community.

:::warning
These tools will generate keystore files for staking validators as well as the important mnemonic. This mnemonic must be handled and stored securely.
:::

### Import a validator keystore to Lodestar

To import a validator JSON keystore that was created via one of the methods described above, you must locate the file for import (ex. `keystore-m_12381_3600_0_0_0-1654128694.json`).

Inside the keystore JSON file, you should have an [EIP-2335 keystore file](https://github.com/ethereum/EIPs/blob/master/EIPS/eip-2335.md#json-schema).

You will also need the passphrase used the encrypt the keystore. This can be specified interactively, or provided in a plaintext file.

#### Option 1: Import Keys To Lodestar's Keystores Folder

You can load the keys into the keystore folder using the [`validator import`](../validator-management/validator-cli.md#validator-import) command. There are two methods for importing keystores:

_Interactive passphrase import_

```bash
./lodestar validator import --importKeystores ./validator_keys
```

_Plaintext passphrase file import_

```bash
./lodestar validator import --importKeystores ./validator_keys --importKeystoresPassword ./password.txt
```

:::info
The interactive passphrase import method will prompt every keystore in the `validator_keys` folder for import and will ask for the individual password for each keystore. **This method will allow you to import multiple keystores with different passwords.**

The plaintext passphrase file import method will allow you to import all keystores in the `validator_keys` folder encrypted with the same password contained in `password.txt` for efficiency.
:::

Once imported with either method, these keystores will be automatically loaded when you start the validator. To list the imported keystores, use the [`validator list`](./validator-cli.md#validator-list) command.

---

#### Option 2: Import Keys When Starting the Validator

To import keys when you start the validator specify the [`--importKeystores`](./validator-cli.md#--importkeystores) and [`--importKeystoresPassword`](./validator-cli.md#--importkeystorespassword) flags with the [`validator`](./validator-cli.md#base-validator-command) command:

```bash
./lodestar validator --importKeystores ./validator_keys --importKeystoresPassword ./password.txt
```

:::warning
If you import keys using `--importKeystores` at runtime (Option 2) any keys loaded to the keystores folder from Option 1 will be ignored.
:::

### Configuring the fee recipient address

Post-Merge Ethereum requires validators to set a **Fee Recipient** which allows you to receive priority fees when proposing blocks. If you do not set this address, your priority fees will be sent to the [burn address](https://etherscan.io/address/0x0000000000000000000000000000000000000000).

Configure your validator client's fee recipient address by using the [`--suggestedFeeRecipient`](./validator-cli.md#--suggestedfeerecipient) flag. Ensure you specify an Ethereum address you control. An example of a fee recipient set with the address `0xB7576e9d314Df41EC5506494293Afb1bd5D3f65d` would add the following flag to their configuration: `--suggestedFeeRecipient 0xB7576e9d314Df41EC5506494293Afb1bd5D3f65d`.

You may choose to use the [`--strictFeeRecipientCheck`](./validator-cli.md#--strictfeerecipientcheck) flag to enable a strict check of the fee recipient address with the one returned by the beacon node for added reassurance.

:::note
If you would like to set unique proposer metadata (e.g. fee recipient address) for each validator you are running, see the [Proposer Configuration](./proposer-config.md) feature. This feature is also available via the keymanager API.
:::

### Configure your builder selection and/or builder boost factor

These validator configurations signal whether the beacon node should prefer a builder bid or a local execution payload. Before Gloas, builder bids require configured builder relays. Starting with Gloas, builder bids may be received in-protocol over p2p or out-of-protocol through a builder API.

With `produceBlockV3` introduced in Deneb hard fork, the [`--builder.boostFactor`](./validator-cli.md#--builderboostfactor) is a percentage multiplier the block producing beacon node must apply to boost (&gt;100) or dampen (&lt;100) builder block value for selection against execution block. The multiplier is ignored if [`--builder.selection`](./validator-cli.md#--builderselection) is set to anything other than `maxprofit`. Even though this is set on the validator client, the calculation is requested and applied on the beacon node itself. For more information, see the [produceBlockV3 Beacon API](https://ethereum.github.io/beacon-APIs/#/ValidatorRequiredApi/produceBlockV3).

With `produceBlockV4` introduced in Gloas, the validator client converts [`--builder.selection`](./validator-cli.md#--builderselection) aliases to a global `builder_boost_factor`, which applies to viable builder bids regardless of whether they were received over p2p or through a builder API. A value of `0` prefers the local payload but uses a viable builder bid if local production fails or is delayed. A value of `100` selects by profit, and `18446744073709551615` (2\*\*64 - 1) prefers the builder bid with local production as fallback. For more information, see the [produceBlockV4 Beacon API](https://ethereum.github.io/beacon-APIs/#/ValidatorRequiredApi/produceBlockV4).

With Lodestar's [`--builder.selection`](./validator-cli.md#--builderselection) validator options, you can select:

- `default`: Default setting for Lodestar set at `--builder.boostFactor=90`. This default setting will have a local block boost of ~10%. Note that this value might change in the future depending on what we think is the most appropriate value to help improve censorship resistance of Ethereum.
- `maxprofit`: An alias of `--builder.boostFactor=100`, which will always choose the more profitable block. Using this option, you may customize your `--builder.boostFactor` to your preference. Examples of its usage are below.
- `executionalways`: An alias of `--builder.boostFactor=0`, which will select the local execution block, unless it fails to produce due to an error or a delay in the response from the execution client.
- `executiononly`: Pre-Gloas only. The beacon node will produce a local execution block even if builder relays are configured and will error if it cannot produce one. Starting with Gloas, this is treated as `executionalways` so a viable builder bid can prevent a missed proposal when local production fails or is delayed.
- `builderalways`: An alias of `--builder.boostFactor=18446744073709551615` (2\*\*64 - 1), which will select the builder block, unless the builder block fails to produce. The builder block may fail to produce if it's not available, not timely or there is an indication of censorship via `shouldOverrideBuilder` from the execution payload response.

#### Calculating builder boost factor with examples

To calculate the builder boost factor setting, you need to know what percentage you will accept a builder block for against a local execution block using the following formula: `100*100/(100+percentage)`. The value passed to [`--builder.boostFactor`](./validator-cli.md#--builderboostfactor) must be a valid number without decimals.

Example 1: I will only accept a builder block with 25% more value than the local execution block.

```ts
10000/(100+25) = 80
```

Therefore, `--builder.boostFactor=80`.

Example 2: Setting a `--builder.boostFactor=0` will always prefer the local execution block, but will produce an available builder block if the local execution block fails.

Example 3: Setting a `--builder.boostFactor=100` is the same as signaling `--builder.selection maxprofit` where the validator will always select the most profitable block between the local execution engine and the builder block from the relay.

### Configure external builders (Gloas)

Starting with Gloas, external builders are configured on the validator client and the beacon node requests bids on its behalf. Use [`--builder.urls`](./validator-cli.md#--builderurls) to name the builders to request bids from. Bids received over p2p are always considered alongside them, governed by the same selection settings.

Every bid request is authenticated with data the builder expects, by default the UTF-8 bytes of the builder URL exactly as configured. If a builder requires different auth data agreed out of band, append it as a hex fragment to its URL, e.g. `--builder.urls https://builder.example.com#0x0123`. The fragment is stripped before the URL is used and never sent to the builder. Auth data that must stay secret is better kept in the [proposer configuration file](./proposer-config.md), as command line arguments are visible to other processes.

- [`--builder.minBid`](./validator-cli.md#--builderminbid): minimum total payment in Gwei accepted from a builder bid, counting the bid value plus its execution payment. Bids below the floor are rejected.
- [`--builder.maxExecutionPayment`](./validator-cli.md#--buildermaxexecutionpayment): maximum execution layer payment in Gwei accepted from a builder. The default of `0` only accepts trustless payments backed by the builder's staked collateral. An execution layer payment is only a promise by the builder to pay as part of the block, so values above `0` require the explicit [`--allowDangerousTrustedPayments`](./validator-cli.md#--allowdangeroustrustedpayments) opt-in.

Builders can also be configured per validator key with per-builder overrides via the [Set Builder Configuration keymanager endpoint](https://ethereum.github.io/keymanager-APIs/#/Builder%20Config) or the [proposer configuration file](./proposer-config.md).

### Submit a validator deposit

Please use the official Ethereum Launchpad to perform your deposits. Ensure your deposits are sent to the proper beacon chain deposit address on the correct network.

#### Mainnet

- [Ethereum Mainnet Launchpad](https://launchpad.ethereum.org)
- [Beacon Chain Deposit Contract](https://etherscan.io/address/0x00000000219ab540356cbb839cbe05303d7705fa) `0x00000000219ab540356cBB839Cbe05303d7705Fa`

#### Hoodi Testnet

- [Ethereum Hoodi Testnet Launchpad](https://hoodi.launchpad.ethereum.org)
- [Hoodi Beacon Chain Deposit Contract](https://hoodi.etherscan.io/address/0x00000000219ab540356cBB839Cbe05303d7705Fa) `0x00000000219ab540356cBB839Cbe05303d7705Fa`

#### Ephemery Testnet

- [Ethereum Ephemery Testnet Launchpad](https://launchpad.ephemery.dev/)
- [Ephemeral Testnet Resources](https://ephemery.dev/)

### Slashing protection

Slashing protection is enabled by default and cannot be disabled by the user. The slashing protection database is stored in non human-readable format in the `validator-db` folder, which can be found in the root data directory (see `--dataDir` flag). If you migrate to or from a different client, please use the [slashing protection import](./validator-cli.md#validator-slashing-protection-import) or [export](./validator-cli.md#validator-slashing-protection-export) commands to transfer your data.

## Run the validator

To start a Lodestar validator run the command:

```bash
./lodestar validator --network $NETWORK_NAME
```

You should see confirmation that modules have started.

```txt
Mar-31 15:24:03.193[]                 info: Lodestar network=hoodi, version=v1.28.1/d565aac, commit=d565aac1d211c8de7d9805ca5f715dd02660d201
Mar-31 15:24:03.194[]                 info: Connecting to LevelDB database path=/data/validator-db
Mar-31 15:27:16.511[]                 info: 2 local keystores
Mar-31 15:27:16.512[]                 info: 0xad3751569b3b7ee67d85e1440fcb954533146ee6545ec23ee78ad1fe680029e4a1869330c8f053ee0fcc0f71a60f9167
Mar-31 15:27:16.512[]                 info: 0xa8a423cbeaca51064d7b5c04c10fdad0114d71a42786d3dbc835b5b00b481872c55af0cf2af10fb5412f2a66695b5aac
Mar-31 15:27:20.843[]                 info: Started metrics HTTP server address=http://127.0.0.1:5064
Mar-31 15:27:20.849[]                 info: Beacon node urls=http://127.0.0.1:9596, requestWireFormat=ssz, responseWireFormat=ssz
Mar-31 15:27:20.867[]                 info: Genesis fetched from the beacon node
Mar-31 15:27:20.872[]                 info: Verified connected beacon node and validator have same the config
Mar-31 15:27:20.873[]                 info: Verified connected beacon node and validator have the same genesisValidatorRoot
Mar-31 15:27:20.873[]                 info: Initializing validator useProduceBlockV3=deneb+, broadcastValidation=consensus, defaultBuilderSelection=default, suggestedFeeRecipient=0x64fdc5a178746d52a5b15e6ac5130b991abaf079, strictFeeRecipientCheck=false
Mar-31 15:27:21.961[]                 info: Started REST API server address=http://127.0.0.1:5062
Mar-31 15:27:21.961[]                 info: REST api server keymanager bearer access token located at: /data/validator-db/api-token.txt
Mar-31 15:27:21.973[]                 info: Node is synced slot=3961036, headSlot=3961035, isOptimistic=false, elOffline=false
Mar-31 15:27:22.230[]                 info: Validator seen on beacon chain validatorIndex=123456, pubKey=0xad3751569b3b6ee67d85e1440fcb954533156ee2560ec23ee78ad1fe680029e4a1869330c8f053ee0fcc0f71a60f9167
Mar-31 15:27:22.230[]                 info: Validator seen on beacon chain validatorIndex=123457, pubKey=0xa8a423cfeaca52054d7b5c04c10fdad0116d71a42786d3dbc835b5b00b481872c55af0cf2af10fb5412f2a66695b5aac
Mar-31 15:27:22.472[]                 info: Validator statuses active=2, total=2
Mar-31 15:27:31.162[]                 info: Published attestations slot=3961037, head=0x2c06…feed, count=2
Mar-31 15:27:38.865[]                 info: Published validator registrations to builder epoch=123782, count=2
```
