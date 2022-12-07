# Validator management

The following instructions are required for stakers utilizing Lodestar.

[TOC]

## Wallet configuration

A wallet helps to manage many validators from a group of 12/24 words (also known as a "mnemonic" or "recovery phrase"). All validators and withdrawal keys can be re-generated from a backed-up mnemonic.

The mnemonic is randomly generated during wallet creation and printed out to the terminal. It's important to make one or more backups of the mnemonic to ensure your ETH wallets are not lost in the case of data loss.

<!-- prettier-ignore-start -->
!!! danger
    It is very important to keep your mnemonic private as it represents the ultimate control of your ETH wallets.
<!-- prettier-ignore-end -->

### Create a wallet

Lodestar is deprecating its functionality to create wallets.

To create a wallet, we recommend using the official [staking-deposit-cli](https://github.com/ethereum/staking-deposit-cli/releases) from the Ethereum Foundation for users comfortable with command line interfaces.

Alternatively, for a graphical user interface, you can use the [Stakehouse Wagyu Key Generator](https://wagyu.gg/) developed by members of the EthStaker community.

<!-- prettier-ignore-start -->
!!! info
    These tools will generate files for staking validators as well as the important mnemonic. This mnemonic must be handled and stored securely.
<!-- prettier-ignore-end -->

## Setup your validator

Validators are represented by a BLS keypair. Use your generated mnemonic from one of the tools above to generate the keystore files required for validator duties on Lodestar.

### Import a validator keystore from your wallet to Lodestar

To import a validator keystore that was created via one of the methods described above, you must locate the validator keystore JSONs exported by those tools (ex. `keystore-m_12381_3600_0_0_0-1654128694.json`).

Inside the keystore JSON file, you should have an [EIP-2335 conformant keystore file](https://github.com/ethereum/EIPs/blob/master/EIPS/eip-2335.md#json-schema) such as the example below:

```
{
  "crypto": {
    "kdf": {
      "function": "scrypt",
      "params": {
        "dklen": 32,
        "n": 262144,
        "r": 8,
        "p": 1,
        "salt": "30bb9ef21d9f1f946c3c7ab70e27f453180a49d473a2a3e79ca2bc715ac4e898"
      },
      "message": ""
    },
    "checksum": {
      "function": "sha256",
      "params": {},
      "message": "ba3cf1c8ba5be4f90c36bcf44ee37a779eac8c54b72121e4755b6722e95164a7"
    },
    "cipher": {
      "function": "aes-128-ctr",
      "params": {
        "iv": "90f76d9d4d1b089e89802eac2f80b6b7"
      },
      "message": "8de2b0f55da54719822db6c083f0436ff94cd638be96c57b91339b438e9355f6"
    }
  },
  "description": "",
  "pubkey": "b22690ca679edd5fb9c2545f358da1427b8310e8ccf9e7e4f01ddce9b1d711a0362d35225673cce8f33911a22ae1519e",
  "path": "m/12381/3600/0/0/0",
  "uuid": "de83e8dc-8f95-4ea0-b9ba-cfa608ff3483",
  "version": 4
}
```

These keystore files can be imported into your Lodestar's keystores folder with the `--importKeystores` command.

```bash
./lodestar validator \
  --importKeystores keystore-m_12381_3600_0_0_0-1654128694.json
```

Similarly, create a `password.txt` file with the password you set for your keystores and import it with the `--importKeystoresPassword` command.

```bash
./lodestar validator \
  --importKeystores keystore-m_12381_3600_0_0_0-1654128694.json \
  --importKeystoresPassword password.txt
```

### Configuring the fee recipient address

Post-Merge Ethereum requires validators to set a **Fee Recipient** which allows you to receive priority fees when proposing blocks. If you do not set this address, your priority fees will be sent to the [burn address](https://etherscan.io/address/0x0000000000000000000000000000000000000000).

Configure your validator client's fee recipient address by using the `--suggestedFeeRecipient` flag. Ensure you specify an Ethereum address you control. An example of a fee recipient set with the address `0xB7576e9d314Df41EC5506494293Afb1bd5D3f65d` would add the following flag to their configuration: `--suggestedFeeRecipient 0xB7576e9d314Df41EC5506494293Afb1bd5D3f65d`.

You may choose to use the `--strictFeeRecipientCheck` flag to enable a strict check of the fee recipient address with the one returned by the beacon node for added reassurance.

### Submit a validator deposit

Please use the official tools to perform your deposits
- `staking-deposit-cli`: <https://github.com/ethereum/staking-deposit-cli>
- Ethereum Foundation launchpad: <https://launchpad.ethereum.org>

## Run the validator

To start a Lodestar validator run the command:

```bash
./lodestar validator --network $NETWORK_NAME
```

You should see confirmation that modules have started.

```bash
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
