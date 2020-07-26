# Key management

## Wallet management

A wallet helps to manage many validators from an easy-to-remember 12-word string (a mnemonic). All validators and withdrawal keys can be re-generated from a backed-up mnemonic.

The 12-word string is randomly generated during wallet creation and printed out to the terminal. It's important to make one or more backups of the mnemonic to ensure your ETH is not lost in the case of data loss. It is very important to keep your mnemonic private as it represents the ultimate control of your ETH.

### Create a wallet

To create a wallet, use the following command:

```
lodestar account wallet create --name primary --passphrase-file primary.pass
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

### Create validator keypair

To create a new validator use the following command:

```
lodestar account validator create --name primary --passphrase-file primary.pass
```

This command will:

- Derive a new BLS keypair from the wallet `primary`.
- Create a new directory in `./lodestar/keystores` containing:
  - An encrypted Keystore with the validator voting keypair.
  - An eth1_deposit_data.rlp file with the precomputed Eth1 deposit transaction data ready to be submitted to the deposit contract.
- Store the validator voting Keystore password in `./lodestar/secrets`.
- Print the validator public key to the terminal

<!-- prettier-ignore-start -->
!!! info
    The validator voting keypair must be "hot" so its Keystore and password are kept in disk to be available for the validator client. The withdrawal keypair is **not** kept in disk as it can be generated latter from the wallet mnemonic.
<!-- prettier-ignore-end -->

### Submit a validator deposit

To submit the deposit transaction for a validator, use the following command with one of these options to connect to an Eth1 node:

- To fund the deposit with a local Keystore use the `--keystorePath` and `--keystorePassword` arguments. You should provide a `--rpcUrl` to connect to an Eth1 node and broadcast the transaction.
- To fund the deposit with your local node with accounts you can connect directly to it with
  - `--ipcPath` to connect to the node via IPC.
  - `--rpcUrl` and `--rpcPassword` to connect to the node's JSON RPC API and unlock its account.
  - `--rpcUrl` alone to connect to the node's JSON RPC API if it's already unlocked.

```
lodestar account validator deposit --validator 0x88f920bb56d76c68e0d983e9772e67d2ba4afadd5eb162a51f7fc62212c138e5611d99f98f834fce43f310295ca35eca
```

The resulting transaction hash will be print to the terminal and also stored in the validator's dir. 

<!-- prettier-ignore-start -->
!!! info
    The existance of the transaction hash file will block subsecuent deposits for the same validator.
<!-- prettier-ignore-end -->
