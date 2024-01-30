# Validator Configuration

The following instructions are for stakers utilizing the Lodestar validator client.

[TOC]

## Wallet configuration

A wallet helps to manage many validators from a group of 12/24 words (also known as a "mnemonic" or "recovery phrase"). All validators and withdrawal keys can be re-generated from a backed-up mnemonic.

The mnemonic is randomly generated during wallet creation and printed out to the terminal. It's important to make one or more backups of the mnemonic to ensure your ETH wallets are not lost in the case of data loss.

<!-- prettier-ignore-start -->
!!! danger
    It is very important to keep your mnemonic private as it represents the ultimate control of your ETH wallets.
<!-- prettier-ignore-end -->

### Create a wallet

Lodestar has removed its functionality to create wallets.

To create a wallet, we recommend using the official [`staking-deposit-cli`](https://github.com/ethereum/staking-deposit-cli/releases) from the Ethereum Foundation for users comfortable with command line interfaces.

Alternatively, for a graphical user interface, you can use the [Stakehouse Wagyu Key Generator](https://wagyu.gg/) developed by members of the EthStaker community.

<!-- prettier-ignore-start -->
!!! info
    These tools will generate files for staking validators as well as the important mnemonic. This mnemonic must be handled and stored securely.
<!-- prettier-ignore-end -->

## Setup your validator

Validators are represented by a BLS keypair. Use your generated mnemonic from one of the tools above to generate the keystore files required for validator duties on Lodestar.

### Import a validator keystore from your wallet to Lodestar

To import a validator keystore that was created via one of the methods described above, you must locate the validator JSON keystores exported by those tools (ex. `keystore-m_12381_3600_0_0_0-1654128694.json`).

Inside the keystore JSON file, you should have an [EIP-2335 keystore file](https://github.com/ethereum/EIPs/blob/master/EIPS/eip-2335.md#json-schema).

You will also need the passphrase used the encrypt the keystore. This can be specified interactively, or provided in a plaintext file.

#### Option 1: Import Keys To Lodestar's Keystores Folder

You can load the keys into the keystore folder using the `validator import` command. There are two methods for importing keystores:

_Interactive passphrase import_

```bash
./lodestar validator import --importKeystores ./validator_keys
```

_Plaintext passphrase file import_

```bash
./lodestar validator import --importKeystores ./validator_keys --importKeystoresPassword ./password.txt
```

<!-- prettier-ignore-start -->
!!! info
    The interactive passphrase import method will prompt every keystore in the `validator_keys` folder for import and will ask for the individual password for each keystore. **This method will allow you to import multiple keystores with different passwords.**

    The plaintext passphrase file import method will allow  to import all keystores in the `validator_keys` folder with the same password contained in `password.txt` for efficiency. 
<!-- prettier-ignore-end -->

Once imported with either method, these keystores will be automatically loaded when you start the validator. To list the imported keystores, use the `validator list` command.

---

#### Option 2: Import Keys When Starting the Validator

To import keys when you start the validator specify the `--importKeystores` and `--importKeystoresPassword` flags with the `validator` command:

```bash
./lodestar validator --importKeystores ./validator_keys --importKeystoresPassword ./password.txt
```

<!-- prettier-ignore-start -->
!!! warning
    If you import keys using `--importKeystores` at runtime (Option 2) any keys loaded to the keystores folder from Option 1 will be ignored.
<!-- prettier-ignore-end -->

### Configuring the fee recipient address

Post-Merge Ethereum requires validators to set a **Fee Recipient** which allows you to receive priority fees when proposing blocks. If you do not set this address, your priority fees will be sent to the [burn address](https://etherscan.io/address/0x0000000000000000000000000000000000000000).

Configure your validator client's fee recipient address by using the `--suggestedFeeRecipient` flag. Ensure you specify an Ethereum address you control. An example of a fee recipient set with the address `0xB7576e9d314Df41EC5506494293Afb1bd5D3f65d` would add the following flag to their configuration: `--suggestedFeeRecipient 0xB7576e9d314Df41EC5506494293Afb1bd5D3f65d`.

You may choose to use the `--strictFeeRecipientCheck` flag to enable a strict check of the fee recipient address with the one returned by the beacon node for added reassurance.

### Configure your builder selection and/or builder boost factor

If you are running a beacon node with connected builder relays, you may use these validator configurations to signal which block (builder vs. local execution) the beacon node should produce.

With produceBlockV3 (enabled automatically after the Deneb hard fork), the `--builder.boostFactor` is a percentage multiplier the block producing beacon node must apply to boost (>100) or dampen (<100) builder block value for selection against execution block. The multiplier is ignored if `--builder.selection` is set to anything other than `maxprofit`. Even though this is set on the validator client, the calculation is requested and applied on the beacon node itself. For more information, see the [produceBlockV3 Beacon API](https://ethereum.github.io/beacon-APIs/#/ValidatorRequiredApi/produceBlockV3).

With Lodestar's `--builder.selection` validator options, you can select:

- `maxprofit`: Default setting for Lodestar set at `--builder.boostFactor=100`. This default setting will always choose the more profitable block. Using this option, you may customize your `--builder.boostFactor` to your preference. Examples of its usage are below.
- `executiononly`: Beacon node will be requested to produce local execution block even if builder relays are configured. This option will always select the local execution block and will error if it couldn't produce one.
- `builderalways`: An alias of `--builder.boostFactor=18446744073709551615` (2**64 - 1), which will select the builder block, unless the builder block fails to produce. The builder block may fail to produce if it's not available, not timely or there is an indication of censorship via `shouldOverrideBuilder` from the execution payload response.
- `builderonly`: Generally used for distributed validators (DVs). No execution block production will be triggered. Therefore, if a builder block is not produced, the API will fail and _no block will be produced_.

#### Calculating builder boost factor with examples

To calculate the builder boost factor setting, you need to know what percentage you will accept a builder block for against a local execution block using the following formula: `100*100/(100+percentage)`. The value passed to `--builder.boostFactor` must be a valid number without decimals.

Example 1: I will only accept a builder block with 25% more value than the local execution block.
```
10000/(100+25) = 80
```
Therefore, `--builder.boostFactor=80`.

Example 2: Setting a `--builder.boostFactor=0` will always prefer the local execution block, but will produce an available builder block if the local execution block fails.

Example 3: Setting a `--builder.boostFactor=100` is the same as signaling `--builder.selection maxprofit` where the validator will always select the most profitable block between the local execution engine and the builder block from the relay.

### Submit a validator deposit

Please use the official Ethereum Launchpad to perform your deposits

- Ethereum Foundation launchpad: <https://launchpad.ethereum.org>

## Run the validator

To start a Lodestar validator run the command:

```bash
./lodestar validator --network $NETWORK_NAME
```

You should see confirmation that modules have started.

```
Nov-29 10:47:13.647[]                 info: Lodestar network=sepolia, version=v1.2.2/f093b46, commit=f093b468ec3ab0dbbe8e2d2c8175f52ad88aa35f
Nov-29 10:47:13.649[]                 info: Connecting to LevelDB database path=/home/user/.local/share/lodestar/sepolia/validator-db
Nov-29 10:47:51.732[]                 info: 3 local keystores
Nov-29 10:47:51.735[]                 info: 0x800f6be579b31ea950a50be65f7de8f678b23b7466579c01ac26ebf9c19599fb2b446da40ad4fc92c6109fcd6793303f
Nov-29 10:47:51.735[]                 info: 0x81337ebe90d6942d8b61922ea880c4d28ebc745ddc10a1acc85b745a15c6c8754af1a73b1b3483b6a5024b783510b35c
Nov-29 10:47:51.757[]                 info: 0xb95fc0ec39596deee2c4363f57bb4786f5bb8dfb345c1e5b14e2927be482615971d0d81f9a88b3389fac7079b3cb2f46
Nov-29 10:47:51.776[]                 info: Genesis fetched from the beacon node
Nov-29 10:47:51.781[]                 info: Verified connected beacon node and validator have same the config
Nov-29 10:47:51.837[]                 info: Verified connected beacon node and validator have the same genesisValidatorRoot
Nov-29 10:47:51.914[]                 info: Discovered new validators count=100
Nov-29 10:48:00.197[]                 info: Published SyncCommitteeMessage slot=1165140, count=27
Nov-29 10:48:02.296[]                 info: Published attestations slot=1165140, count=6
Nov-29 10:48:08.122[]                 info: Published aggregateAndProofs slot=1165140, index=0, count=2
Nov-29 10:48:12.102[]                 info: Published SyncCommitteeMessage slot=1165141, count=27
Nov-29 10:48:14.236[]                 info: Published attestations slot=1165141, count=4
```
