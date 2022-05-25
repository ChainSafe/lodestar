# Key management

## Wallet management

A wallet helps to manage many validators from an easy-to-remember 12-word string (a mnemonic). All validators and withdrawal keys can be re-generated from a backed-up mnemonic.

The 12-word string is randomly generated during wallet creation and printed out to the terminal. It's important to make one or more backups of the mnemonic to ensure your ETH is not lost in the case of data loss. It is very important to keep your mnemonic private as it represents the ultimate control of your ETH.

<!-- prettier-ignore-start -->
!!! warning
    If you want to create a wallet for a testnet, you need to add `--network $TESTNET_NAME` to the following command
<!-- prettier-ignore-end -->

### Create a wallet

To create a wallet, use the following command:

```bash
lodestar account wallet create --name primary --passphraseFile primary.pass
```

This command will:

- Create a hierarchical deterministic wallet identified with the name `primary`. This name can be arbitrary and is only used to reference the wallet in subsequent commands.
- Generate a random strong password and stored in `primary.pass`.

<!-- prettier-ignore-start -->
!!! info
    `primary.pass` is not the actual passphrase, but the contents of the file `primary.pass`. This ensures you do not keep passphrases in your terminal history.
<!-- prettier-ignore-end -->

Next, you can create validator keys from your wallet `primary`

## Validator management

Validators are represented by a BLS keypair. It is recommended to generate validator keypairs from a wallet mnemonic to ease its backup.

<!-- prettier-ignore-start -->
!!! warning
    If you want to create a validator for a testnet, you need to add `--network $TESTNET_NAME` to all of the following commands and will use the `.$TESTNET_NAME` directory instead of `.lodestar`
<!-- prettier-ignore-end -->

### Create validator keypair

To create a new validator use the following command:

```bash
lodestar account validator create --name primary --passphraseFile primary.pass
```

This command will:

- Derive a new BLS keypair from the wallet `primary`.
- Create a new directory in `.lodestar/keystores` containing: - An encrypted Keystore with the validator voting keypair. - An eth1_deposit_data.rlp file with the precomputed Eth1 deposit transaction data ready to be submitted to the deposit contract.
- Store the validator voting Keystore password in `.lodestar/secrets`.
- Print the validator public key to the terminal

<!-- prettier-ignore-start -->
!!! info
    The validator voting keypair must be "hot" so its Keystore and password are kept in disk to be available for the validator client. The withdrawal keypair is **not** kept in disk as it can be generated later from the wallet mnemonic.
<!-- prettier-ignore-end -->

### Import a validator keystore from Deposit Launch Pad

To import a keystore that was created via the ETH2.0 Deposit Launch Pad:

```bash
./lodestar account validator import --network $TESTNET_NAME --directory <path to your launchpad keys>
```

You will be prompted to enter a password. Use the same one you used to create the keys initially.

To confirm your keys have been imported run:

```bash
./lodestar account validator list --network $TESTNET_NAME
```

This command will print the public address of every active keystore.

### Submit a validator deposit

DEPRECATED. Please use the official tools to perform your deposits - `staking-deposit-cli`: https://github.com/ethereum/staking-deposit-cli - Ethereum Foundation launchpad: https://launchpad.ethereum.org/en/
