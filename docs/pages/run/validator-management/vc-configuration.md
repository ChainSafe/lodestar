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
If you would like to set unique proposer metadata (e.g. fee recipient address) for each validator you are running, see the [Proposer Configuration](./proposer-config.md) feature.
:::

### Configure your builder selection and/or builder boost factor

If you are running a beacon node with connected builder relays, you may use these validator configurations to signal which block (builder vs. local execution) the beacon node should produce.

With produceBlockV3 (enabled automatically after the Deneb hard fork), the [`--builder.boostFactor`](./validator-cli.md#--builderboostfactor) is a percentage multiplier the block producing beacon node must apply to boost (&gt;100) or dampen (&lt;100) builder block value for selection against execution block. The multiplier is ignored if [`--builder.selection`](./validator-cli.md#--builderselection) is set to anything other than `maxprofit`. Even though this is set on the validator client, the calculation is requested and applied on the beacon node itself. For more information, see the [produceBlockV3 Beacon API](https://ethereum.github.io/beacon-APIs/#/ValidatorRequiredApi/produceBlockV3).

With Lodestar's [`--builder.selection`](./validator-cli.md#--builderselection) validator options, you can select:

- `default`: Default setting for Lodestar set at `--builder.boostFactor=90`. This default setting will have a local block boost of ~10%. Note that this value might change in the future depending on what we think is the most appropriate value to help improve censorship resistance of Ethereum.
- `maxprofit`: An alias of `--builder.boostFactor=100`, which will always choose the more profitable block. Using this option, you may customize your `--builder.boostFactor` to your preference. Examples of its usage are below.
- `executionalways`: An alias of `--builder.boostFactor=0`, which will select the local execution block, unless it fails to produce due to an error or a delay in the response from the execution client.
- `executiononly`: Beacon node will be requested to produce local execution block even if builder relays are configured. This option will always select the local execution block and will error if it couldn't produce one.
- `builderalways`: An alias of `--builder.boostFactor=18446744073709551615` (2\*\*64 - 1), which will select the builder block, unless the builder block fails to produce. The builder block may fail to produce if it's not available, not timely or there is an indication of censorship via `shouldOverrideBuilder` from the execution payload response.
- `builderonly`: Generally used for distributed validators (DVs). No execution block production will be triggered. Therefore, if a builder block is not produced, the API will fail and _no block will be produced_.

#### Calculating builder boost factor with examples

To calculate the builder boost factor setting, you need to know what percentage you will accept a builder block for against a local execution block using the following formula: `100*100/(100+percentage)`. The value passed to [`--builder.boostFactor`](./validator-cli.md#--builderboostfactor) must be a valid number without decimals.

Example 1: I will only accept a builder block with 25% more value than the local execution block.

```ts
10000/(100+25) = 80
```

Therefore, `--builder.boostFactor=80`.

Example 2: Setting a `--builder.boostFactor=0` will always prefer the local execution block, but will produce an available builder block if the local execution block fails.

Example 3: Setting a `--builder.boostFactor=100` is the same as signaling `--builder.selection maxprofit` where the validator will always select the most profitable block between the local execution engine and the builder block from the relay.

### Submit a validator deposit

Please use the official Ethereum Launchpad to perform your deposits. Ensure your deposits are sent to the proper beacon chain deposit address on the correct network.

#### Mainnet

- [Ethereum Mainnet Launchpad](https://launchpad.ethereum.org)
- [Beacon Chain Deposit Contract](https://etherscan.io/address/0x00000000219ab540356cbb839cbe05303d7705fa) `0x00000000219ab540356cBB839Cbe05303d7705Fa`

#### Holesky Testnet

- [Ethereum Holesky Testnet Launchpad](https://holesky.launchpad.ethereum.org)
- [Holesky Beacon Chain Deposit Contract](https://holesky.etherscan.io/address/0x4242424242424242424242424242424242424242) `0x4242424242424242424242424242424242424242`

#### Ephemery Testnet

- [Ethereum Ephemery Testnet Launchpad](https://launchpad.ephemery.dev/)
- [Ephemeral Testnet Resources](https://ephemery.dev/)

## Run the validator

To start a Lodestar validator run the command:

```bash
./lodestar validator --network $NETWORK_NAME
```

You should see confirmation that modules have started.

```txt
Mar-01 03:06:35.048[]                 info: Lodestar network=holesky, version=v1.16.0/6ad9740, commit=6ad9740a085574306cf46c7642e749d6ec9a4264
Mar-01 03:06:35.050[]                 info: Connecting to LevelDB database path=/keystoresDir/validator-db-holesky
Mar-01 03:06:35.697[]                 info: 100% of keystores imported. current=2 total=2 rate=1318.68keys/m
Mar-01 03:06:35.698[]                 info: 2 local keystores
Mar-01 03:06:35.698[]                 info: 0xa6fcfca12e1db6c7341d82327010cd57224dc239d1c5e4fb18286cc32edb877d813c5af1c870d474aef7b3ff7ab927ea
Mar-01 03:06:35.698[]                 info: 0x8f868e53bbe1451bcf6d42c9ab6d292cbd7fbfa09c59b6b99c1dd6a4977e2e7b4b752c328784ca2788dd6f63ffcbdb7e
Mar-01 03:06:35.732[]                 info: Beacon node urls=http://127.0.0.1:9596
Mar-01 03:09:23.813[]                 info: Genesis fetched from the beacon node
Mar-01 03:09:23.816[]                 info: Verified connected beacon node and validator have same the config
Mar-01 03:09:23.818[]                 info: Verified connected beacon node and validator have the same genesisValidatorRoot
Mar-01 03:09:23.818[]                 info: Initializing validator useProduceBlockV3=deneb+, broadcastValidation=gossip, defaultBuilderSelection=executiononly, suggestedFeeRecipient=0xeeef273281fB83F56182eE960aA4bAfe7fE075DE, strictFeeRecipientCheck=false
Mar-01 03:09:23.830[]                 info: Validator seen on beacon chain validatorIndex=1234567, pubKey=0xa6fcfca12e1db6c7341d82327010cd57224dc239d1c5e4fb18286cc32edb877d813c5af1c870d474aef7b3ff7ab927ea
Mar-01 03:09:23.830[]                 info: Validator seen on beacon chain validatorIndex=1234568, pubKey=0x8f868e53bbe1451bcf6d42c9ab6d292cbd7fbfa09c59b6b99c1dd6a4977e2e7b4b752c328784ca2788dd6f63ffcbdb7e
Mar-01 03:09:23.830[]                 info: Validator statuses active=2, total=2
Mar-01 03:15:50.191[]                 info: Published attestations slot=1113379, count=1
Mar-01 03:16:02.728[]                 info: Published attestations slot=1113380, count=1
```
