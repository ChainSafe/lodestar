# Quick Start Custom Setup Guide

This is a step-by-step guide to utilize [@ChainSafe/lodestar-quickstart](https://github.com/ChainSafe/lodestar-quickstart) to setup a Ubuntu-based full Ethereum node using a local execution client and ChainSafe's Lodestar consensus client via Docker (the recommended method to use Lodestar for production environments). This is an adaptation of [Somer Esat's guides](https://someresat.medium.com/) for the Ethereum staking community.

This guide will provide instructions which include running a local execution node. This guide uses Lodestar's `stable` release branch and supports **Holesky** testnet setups and **Mainnet**.

:::info
This guide specifically focuses on using Lodestar's Quickstart scripts which allows for near instant setup with the following technologies:

- [Ubuntu v22.04 (LTS) x64 server](https://releases.ubuntu.com/22.04/)
- Ethereum Execution (eth1) clients:
  - [Erigon](https://github.com/ledgerwatch/erigon/releases) | [Github](https://github.com/ledgerwatch/erigon)
  - [Go-Ethereum (Geth)](https://geth.ethereum.org/) | [Github](https://github.com/ethereum/go-ethereum/releases/)
  - [Hyperledger Besu](https://www.hyperledger.org/) | [Github](https://github.com/hyperledger/besu)
  - [Nethermind](https://nethermind.io/) | [Github](https://github.com/NethermindEth/nethermind)
  - [Rust](https://reth.rs) | [Github](https://github.com/paradigmxyz/reth)
- [ChainSafe's Lodestar Ethereum Consensus Client](https://lodestar.chainsafe.io/) | [Github](https://github.com/ChainSafe/lodestar)
- [Docker Engine](https://docs.docker.com/engine/)
  :::

:::danger
This guide **_does not_** assist with securing your server such as secure SSH logins or enabling firewalls. Ensure you have limited access to your server and blocked unused ports with guides such as [CoinCashew's Security Best Practices for your ETH staking validator node](https://www.coincashew.com/coins/overview-eth/guide-or-how-to-setup-a-validator-on-eth2-mainnet/part-i-installation/guide-or-security-best-practices-for-a-eth2-validator-beaconchain-node) before continuing with this guide.
:::

:::warning
This guide is for informational purposes only and does not constitute professional advice. The author does not guarantee accuracy of the information in this article and the author is not responsible for any damages or losses incurred by following this article. A full disclaimer can be found at the bottom of this page — please read before continuing.
:::

## Support

For technical support please reach out to:

- The Lodestar team actively develops and collaborates on the [ChainSafe Discord Server](https://discord.gg/642wB3XC3Q) under **_#:star2:-lodestar-general_** channel.
- Please subscribe to our Discord server announcements on the [ChainSafe Discord Server](https://discord.gg/642wB3XC3Q) under **_#lodestar-announcements_** channel.

## Prerequisites

This guide assumes knowledge of Ethereum (ETH), Docker, staking and Linux.

You require the following before getting started:

- [Ubuntu Server v22.04 (LTS) amd64](https://releases.ubuntu.com/22.04/) or newer, installed and running on a local machine or in the cloud. _A locally running machine is encouraged for greater decentralization — if the cloud provider goes down then all nodes hosted with that provider go down._

- 32 ETH to run a solo validator with Lodestar. If running on testnet, contact us in our [ChainSafe Discord Server](https://discord.gg/642wB3XC3Q) for testnet Ether.

## Testnet to Mainnet

If moving from a testnet setup to a mainnet setup it is strongly recommended that you start on a fresh (newly installed) server instance. This guide has not been tested for migration scenarios and does not guarantee success if you are using an existing instance with previously installed testnet software.

## Hardware Requirements

|           | Minimum                                | Recommended                            |
| --------- | -------------------------------------- | -------------------------------------- |
| Processor | Intel Core i3–9100 or AMD Ryzen 5 3450 | Intel Core i7–9700 or AMD Ryzen 7 4700 |
| Memory    | 8 GB RAM                               | 16 GB RAM                              |
| Storage   | 130 GB available space SSD             | 200 GB available space SSD             |
| Internet  | Reliable broadband with 10mbps upload  | Reliable broadband with >10mbps upload |

:::info
Check your available disk space. Even you have a large SSD there are cases where Ubuntu is reporting only 100GB free. If this applies to you then take a look at [**_Appendix A — Expanding the Logical Volume._**](#appendix-a---expanding-the-logical-volume)
:::

---

## Setup Machine & Repository

### Install Docker Engine & Docker Compose

We must install Docker Engine to run the images on your local machine.

#### Add Docker's GPG keyrings

Run each line one at a time.

```bash=
sudo apt-get update
sudo apt-get install ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
```

#### Add the repository to Apt sources

Copy and paste the entire command below.

```bash
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

#### Update Ubuntu

Ensure all updates to your Ubuntu Server are complete.

```bash=
sudo apt-get update
sudo apt-get upgrade -y
```

Hit `Enter` if required to restart services.

#### Install Docker Engine

```bash
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

#### Test Docker

```bash
sudo docker run hello-world
```

If you see the message `Hello from Docker!
This message shows that your installation appears to be working correctly.`, you can move on to the next step.

#### Clone lodestar-quickstart repository

Clone the [lodestar-quickstart](https://github.com/ChainSafe/lodestar-quickstart) from Github into your local server.

```bash
cd ~ && git clone https://github.com/ChainSafe/lodestar-quickstart.git
```

## Configure Lodestar Quick Scripts

### Navigate to the root directory

The script and required files are located within the `lodestar-quickstart` folder.

```
cd lodestar-quickstart
```

### Create your own JWT Secret

We will generate a JWT secret that is shared by the Execution client and Lodestar in order to have a required secure connection for the `Engine API` on port `8551`.

```
openssl rand -hex 32 | tr -d "\n" > "jwtsecret"
```

Confirm that your JWT token created.

```
cat jwtsecret ; echo
```

Your terminal should display the secret. Copy the token for the next step. Be careful to only copy the 64 characters corresponding to the secret and nothing else.

:::danger
:rotating_light: **WARNING:** Do not share this secret as it protects your authenticated port 8551.
:::

### Input your JWT Secret into the `import-args.sh` script

Edit the `import-args.sh` file.

```sh
nano import-args.sh
```

Replace the 64 characters after `0x` with your token.

If you are not running validators, press `CTRL` + `x` then `y` then `Enter` to save and exit. Proceed to Configuring your Network.

### Configure feeRecipient

:::warning
If you are running validators, Ethereum requires validators to set a **Fee Recipient** which allows you to receive priority fees and MEV rewards when proposing blocks. If you do not set this address, your rewards will be sent to the [burn address by default](https://etherscan.io/address/0x0000000000000000000000000000000000000000).
:::

Configure your validator client's feeRecipient address by changing the `FEE_RECIPIENT` line. Ensure you specify an Ethereum address you control.

An example of a fee recipient set with the address `0xB7576e9d314Df41EC5506494293Afb1bd5D3f65d`, you would change the configuration to:

```
FEE_RECIPIENT="0xB7576e9d314Df41EC5506494293Afb1bd5D3f65d"
```

If you would like to run [MEV-Boost](https://boost.flashbots.net) with your validators, proceed to the next section.

If you do not want to run MEV-Boost, press `CTRL` + `x` then `y` then `Enter` to save and exit. Proceed to [Configuring your Network](#configuring-your-network).

### Set minimum bid for MEV-Boost validators

:::info
(Optional): If you are running validators and would like to use MEV-Boost, follow this section. Otherwise, skip this section.
:::

Validators running MEV-Boost maximize their staking reward by selling blockspace to an open market of builders. MEV-Boost v1.4+ allows you to set a minimum bid threshold to only use an externally built block if it meets or exceeds this parameter.

The `min-bid` parameter is denominated in ETH. For example, if you want to set your threshold to 0.03 ETH, set your configuration to `MIN_BUILDERBID=0.03`

When complete, press `CTRL` + `x` then `y` then `Enter` to save and exit.

### Configuring your Network

When using the quick scripts, each supported network has a `.vars` file to define the parameters required for configuring the clients to the specified network.

To view the available files, use the command:

```
ls *.vars
```

### Select your Network

Each network has specifics variables that you may want to setup for use. We will use `Holesky` to demonstrate connecting to a public testnet.

Open the `holesky.vars` file.

```bash
nano holesky.vars
```

### Configure MEV-boost relays

:::info
(Optional): If you have validators you intend to use for MEV-boost, you can input the relays you want to connect here. Otherwise, skip this section.
:::

You can list multiple relays simply by pasting the relay URL as a variable in this file.

```shell=
RELAY_A=https://0xRelayPubKey@relay.com
RELAY_B=https://0xRelayPubKey@relay2.com
```

Make sure to identify the ones you want to use by editing the line:

```shell=
RELAYS="$RELAY_A,$RELAY_B"
```

### Configure Lodestar version

The lodestar-quickstart scripts currently defaults to using our `stable` release branch. To use our nightly `unstable` release instead, replace `LODESTAR_IMAGE=chainsafe/lodestar:latest` with `LODESTAR_IMAGE=chainsafe/lodestar:next` in the `import-images.sh` file.

You may also choose to use a specific version release of Lodestar. To select a specific version, replace the image with `LODESTAR_IMAGE=chainsafe/lodestar:v1.x.x`

:::warning
:warning: We do not recommend using the `unstable` branch or `@chainsafe/lodestar:next` docker versions of Lodestar for production related tasks.
:::

### Modify your weak subjectivity (checkpoint sync) provider

:::note
(Optional): We use ChainSafe's Lodestar checkpoints by default. You may choose to point your trusted checkpoint at another source or verify the checkpoints with other providers. If you would rather sync from genesis (not recommended), you can skip this step.
:::

Weak subjectivity (checkpoint sync) allows your beacon node to sync within minutes by utilizing a trusted checkpoint from a trusted provider.

**We highly recommend using this feature** so you do not need to wait days to sync from genesis and will mitigate your susceptibility to [long-range attacks](https://blog.ethereum.org/2014/11/25/proof-stake-learned-love-weak-subjectivity/).

Minimize your risk of syncing a malicious chain from a malicious checkpoint by verifying the trusted checkpoint from multiple sources.

1. View the community maintained list of [Beacon Chain checkpoint sync endpoints](https://eth-clients.github.io/checkpoint-sync-endpoints/)
2. Verify multiple endpoint links and ensure the latest finalized and latest justified block roots are the same
3. Choose one of those endpoint URLs
4. Replace the `--checkpointSyncUrl` address with your chosen provider.

:::info
**NOTE**: Ensure you use checkpoint URLs from the list above corresponding to the network you are trying to sync or you **will** receive errors.
:::

When complete, press `CTRL` + `x` then `y` then `Enter` to save and exit.

## Modify other client parameters (For advanced users)

:::info
(Optional): We have already set fixed parameters for a seamless setup. If you are looking to customize the default parameters of the clients you are using, follow this section. Otherwise, skip this section.
:::

Fixed parameters for clients can be modified under the `fixed.vars` configuration file.

Under the selected client, modify or add the custom arguments on their corresponding line.

:::note
The following are links to client documentation for CLI commands:

- [**Lodestar CLI Commands**](https://chainsafe.github.io/lodestar/reference/cli/)
- [**Nethermind CLI Commands**](https://docs.nethermind.io/fundamentals/configuration#command-line-options)
- [**Besu CLI Commands**](https://besu.hyperledger.org/en/stable/Reference/CLI/CLI-Syntax/)
- [**Go Ethereum CLI commands**](https://geth.ethereum.org/docs/interface/command-line-options)
- [**Erigon CLI commands**](https://github.com/ledgerwatch/erigon#beacon-chain)
- [**Reth CLI commands**](https://reth.rs/cli/reth.html)
  :::

Once complete, press `CTRL` + `x` then `y` then `Enter` to save and exit.

---

## Setup Validators

:::info
Optional: Skip this entire section if you do not intend to run validators.
:::

### Create validator keystore password

Make sure you are in your main quickstart directory. Create the `pass.txt` file containing your validator's decryption password for use.

```
cd ~/lodestar-quickstart
```

```
nano pass.txt
```

Enter the password for your validators.

:::info
Once the validator container is running, you can delete this file from your server. Note that every time you restart this container, you will need this password to decrypt your keystore.json files.
:::

Once complete, press `CTRL` + `x` then `y` then `Enter` to save and exit.

### Option 1: Setup validators with keystores

If you want to setup validators with your `keystores.json` files follow this section. Otherwise, skip this step.

#### Copy/Move keystores to `lodestar-quickstart/keystores` directory

Your `keystore.json` file(s) generated from the [`staking-deposit-cli`](https://github.com/ethereum/staking-deposit-cli) or similar generator for validator keys will be placed in the `lodestar-quickstart/keystores` directory using the `cp` command to copy or `mv` command to move the files.

```
mkdir keystores
```

:::info
You may choose to use your own method (e.g. SFTP) for copying/uploading keys to your server. This is only a guide.
:::

The format of the command to use is below:

```
cp <from_directory/keystore-x.json> <to_directory>
```

An example usage of this command is:

```
cp /home/user/validator_keys/keystore-x.json ~/lodestar-quickstart/keystores
```

Ensure your `keystore.json` files are in the `lodestar-quickstart/keystores` directory using `ls` command.

```
ls -lsah  ~/lodestar-quickstart/keystores/
```

You should see the keystore files within the directory.

:::info
Ensure the `/keystores` directory only has the `keystore-m_xxxxx.json` files and nothing else. If you copied in the `deposit_data-xxxxx.json` files, you can remove them by using the `sudo rm <file>` command.

Example:

```
sudo rm deposit_data-1552658472.json
```

:::

Continue to the [**Startup Quickstart Script**](#startup-quickstart-script) section.

### Option 2: Setup multiple validator sets with keystores encrypted under different passwords

Optional: If you want to setup validators with your `keystores.json` files but they are not encrypted with the same password, follow this section. Otherwise, skip this step.

This option will allow you to run multiple validator clients corresponding to each validator keystore set encrypted with the same password. Therefore, we will setup `validatorset1` with one decryption password and `validatorset2` with another decryption password. You can repeat these steps to create subsequent validator sets with different keystore decryption passwords.

#### Create validator keystore set directory

Ensure you are in the `lodestar-quickstart` directory and create a folder for your first validator keystore set.

```
cd ~/lodestar-quickstart
```

Make the new directory for set one.

```
mkdir validatorset1
```

Navigate into the directory.

```
cd validatorset1
```

#### Create validator keystore password

Create the `pass.txt` file containing your validator's decryption password for use.

```
nano pass.txt
```

Enter the password for your validators.

:::info
Once the validator container is running, you can delete this file from your server. Note that every time you restart this container, you will need this password to decrypt your keystore.json files.
:::

Once complete, press `CTRL` + `x` then `y` then `Enter` to save and exit.

#### Copy/Move keystores to `lodestar-quickstart/validatorset1/keystores` directory

Your `keystore.json` file(s) generated from the [`staking-deposit-cli`](https://github.com/ethereum/staking-deposit-cli) or similar generator for validator keys will be placed in the `lodestar-quickstart/validatorset1/keystores` directory using the `sudo cp` command to copy or `sudo mv` command to move the files.

```
mkdir keystores
```

The format of the command to use is below:

```
cp <from_directory/keystore-x.json> <to_directory>
```

An example usage of this command is:

```
cp /home/user/validator_keys/keystore-x.json ~/lodestar-quickstart/validatorset1/keystores
```

Ensure your `keystore.json` files are in the `lodestar-quickstart/validatorset1/keystores` directory using `ls` command.

```
ls -lsah  ~/lodestar-quickstart/validatorset1/keystores/
```

You should see the keystore files within the directory.

:::info
Ensure the `/keystores` directory only has the `keystore-m_xxxxx.json` files and nothing else. If you copied in the `deposit_data-xxxxx.json` files, you can remove them by using the `sudo rm <file>` command.

Example:

```
sudo rm deposit_data-1552658472.json
```

:::

Repeat the same steps above for `validatorset2` and any subsequent sets of validators you require. When complete you should have a similar looking directory tree such as the one below:

Then, continue to the [**Startup Quickstart Script**](#startup-quickstart-script) section. Pay particular attention to startup script example five (5) and (6).

### Option 3: Setup validators with mnemonic

:::warning
**TESTNET USE ONLY:** Do not use this method unless you're validating on a testnet. Your mnemonic will be stored in plaintext on your server, which is unsafe.
:::

Optional: If you want to setup validators with your mnemonic. Otherwise, skip this step.

#### Setup Mnemonic

Select the `.vars` file corresponding to the network you want to run. For Holesky, select `holesky.vars`. Open the file with the `nano` text editor and edit the configuration:

```
nano holesky.vars
```

We will modify the `LODESTAR_VALIDATOR_MNEMONIC_ARGS=`. Specifically, the mnemonic located after the `--fromMnemonic` flag.

- Replace the default mnemonic with your mnemonic. Ensure it is between the quotations

- Indicate which indexes of the mnemonic you wish Lodestar to run. Specify a specific index number `--mnemonicIndexes 0` or a range of numbers `--mnemonicIndexes 0..5`

:::info
If you created your mnemonic with one key, it is likely located in index 0. If you've added to it, the generated keys are likely the subsequent indexes.

Therefore, if you generated one key, it is likely in index 0, so you would use `--mnemonicIndexes 0`. If you generated five keys, it is likely in index 0 to 4, so you would use `--mnemonicIndexes 0..4`
:::

Once complete, press `CTRL` + `x` then `y` then `Enter` to save and exit.

Continue to the [**Startup Quickstart Script**](#startup-quickstart-script) section.

---

## Startup Quickstart Script

Ensure you are in the `~/lodestar-quickstart folder.

```
cd ~/lodestar-quickstart
```

The following are **_example commands_** as a template for initiating the quickstart script:

1. Startup a Sepolia beacon node with no validators and Go Ethereum (Geth) execution client with terminals attached:

```
./setup.sh --dataDir sepolia-data --elClient geth --network sepolia --dockerWithSudo --withTerminal "gnome-terminal --disable-factory --"
```

2. Startup Mainnet beacon node with no validators and Nethermind execution client detached from containers (Recommended only when you've verified the setup has initiated properly with terminals attached):

```
./setup.sh --dataDir mainnet-data --elClient nethermind --network mainnet --dockerWithSudo --detached
```

3. Startup Holesky beacon node with validator client (using mnemonic in /keystores) and Erigon execution client detached from containers:

```
./setup.sh --dataDir holesky-data --elClient erigon --network holesky --dockerWithSudo --detached --withValidatorMnemonic ~/lodestar-quickstart/
```

4. Startup Mainnet beacon node with validator client (using keystores) with MEV-Boost and Hyperledger Besu execution client detached from containers:

```
./setup.sh --dataDir mainnet-data --elClient besu --network mainnet --dockerWithSudo --detached --withValidatorKeystore ~/lodestar-quickstart/ --withMevBoost
```

5. Startup Holesky beacon node with validator client set one (using keystores) and execution client Geth detached from containers:

```
./setup.sh --dataDir holesky-data --elClient geth --network holesky --dockerWithSudo --detached --withValidatorKeystore ~/lodestar-quickstart/validatorset1
```

:::warning
You can only start up one set of validator keystores per validator client on the same command. Use the below command (#6) to startup another validator client for another set of validator keys.
:::

6. Startup validator client only with validator client set two (using keystores) and execution client Geth detached from containers:

```
./setup.sh --dataDir holesky-data --elClient geth --network holesky --dockerWithSudo --detached --withValidatorKeystore ~/lodestar-quickstart/validatorset2 --justVC
```

:::info
The script will standardize naming your containers so running the `setup.sh` twice, will not create two instances of the same containers. The script will standardize naming your containers so running the `./setup.sh <args>` a second time, will not create two instances of the same containers.  
:::

Configure the above commands with what you intend to run using the Quickstart Script Help table below.

## Quickstart Script Help

| Command                   | Required/Optional | Description                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dataDir`                 | Required          | File location (volume) of the configuration & data for setup. This directory should be non-existent for the first run. If the directory exists, it will skip fetching the configuration, assuming it has been done previously. You can also clean individual directors of CL/EL between the re-runs.                                                                                                                       |
| `elClient`                | Required          | The selected EL client you want to run with Lodestar. Options are `nethermind`, `besu`, `erigon` or `geth`.                                                                                                                                                                                                                                                                                                                |
| `network`                 | Required          | The network/chain you want to load, reads the corresponding `.vars` (for e.g. `holesky.vars`) network configuration , like images, or urls for EL/CL to interact. Example: Default for Holesky is `--network holesky` using `holesky.vars`.                                                                                                                                                                                |
| `dockerWithSudo`          | Optional          | Provide this argument if your Docker needs a `sudo` prefix.                                                                                                                                                                                                                                                                                                                                                                |
| `--withTerminal`          | Optional\*        | Provide the terminal command prefix for CL and EL processes to run in your favourite terminal. You may use an alias or a terminal launching script as long as it waits for the command it runs till ends and then closes. If not provided, it will launch the docker processes in in-terminal mode.                                                                                                                        |
| `--detached`              | Optional\*        | By default the script will wait for processes and use user input (ctrl +c) to end the processes, however you can pass this option to skip this behavior and just return, for e.g. in case you just want to leave it running.                                                                                                                                                                                               |
| `--withValidatorKeystore` | Optional\*\*      | Launch a validator client using `LODESTAR_VALIDATOR_MNEMONIC_ARGS` (`--withValidatorMnemonic`) or using a folder (`--withValidatorKeystore <abs path to folder`) having `keystores` and `pass.txt` (which advance users may modify in `LODESTAR_VALIDATOR_KEYSTORE_ARGS` as per their setup). Users can spin up multiple validators using `--withValidatorMnemonic <folder path> --justVC` connecting to same beacon node. |
| `--withValidatorMnemonic` | Optional\*\*      | Launch a validator client using mnemonic method.(`LODESTAR_VALIDATOR_MNEMONIC_ARGS`) as set in the network vars file.                                                                                                                                                                                                                                                                                                      |
| `--withMevBoost`          | Optional          | Launch a MEV-Boost container to interface with multiple relays picked for the corresponding network vars file. When paired with `--justCL` or `--justVC` this only activates the builder arguments in the beacon/validator and use the builder url set in MEVBOOST_URL variable in fixed.vars                                                                                                                              |
| `--justEL`                | Optional          | Launch only the Execution Layer client.                                                                                                                                                                                                                                                                                                                                                                                    |
| `--justCL`                | Optional          | Launch only the Lodestar beacon node.                                                                                                                                                                                                                                                                                                                                                                                      |
| `--justVC`                | Optional          | Launch only the Lodestar validator.                                                                                                                                                                                                                                                                                                                                                                                        |
| `--skipImagePull`         | Optional          | Launch with only the local Docker images. Do not update them on this run.                                                                                                                                                                                                                                                                                                                                                  |

:::note
`*` : Only one of the two options should be provided.
`**` : Only one of the two options should be provided.
:::

### Check Containers

You can check the status and get the name of your containers by using the `docker ps` command:

```
sudo docker ps
```

The containers should not constantly restart. If they restart, likely a misconfiguration occurred.

### Check Container Logs

You can check the status of what your container is logging to diagnose a problem or follow along the status of your container output.

Check the logs by using the `docker logs` command:

```
sudo docker logs <CONTAINER NAME>
```

Follow along the logs by adding the `-f` flag:

```
sudo docker logs -f <CONTAINER NAME>
```

Limit the fetched logs by indicating the latest container out puts by number of lines using the `-n <number>` flag. For the last 10 lines:

```
sudo docker logs -n 10 <CONTAINER NAME>
```

### Check beacon node is progressing

Your beacon node should initialize and you should see something similar to:

```
Jul-31 13:35:27.967[]                 info: Lodestar network=mainnet, version=v1.21.0/ff35faa, commit=ff35faae4ad1697b86d708a0367a95a71648ab6e
Jul-31 13:35:28.344[]                 info: Connected to LevelDB database path=/data/lodestar/chain-db
Jul-31 13:35:49.828[]                 info: Initializing beacon from a valid db state slot=9633504, epoch=301047, stateRoot=0xfa2845a6877b98555906a1654941c97d9c05bdd41e61cc0870a967dc9030b156, isWithinWeakSubjectivityPeriod=true
Jul-31 13:35:51.955[chain]            info: Historical state worker started
Jul-31 13:35:51.969[eth1]             info: Eth1 provider urls=http://localhost:8551
Jul-31 13:35:51.975[execution]        info: Execution client urls=http://localhost:8551
Jul-31 13:35:51.977[]                 info: External builder url=http://localhost:8661
Jul-31 13:36:21.128[network]          info: running libp2p instance in worker thread
Jul-31 13:36:21.727[network]          info: libp2p worker started peer=15Uiu2HAmACcmCEXcgt3zCtJL2rqJZ2Mvdjh6U6fe26HgD2FoNRwW
Jul-31 13:36:27.677[network]          info: discv5 worker started peerId=16Uiu2HAmACcmCEXcgt3zCtJL2rqJZ2Mvdjh6U6fe26HgD2FoNRwW, initialENR=enr:-IO4QHGTUd1Zg8LAhUAioOz_ySTKoJLIOa6zltSP_AvvhTFVYw6M6YB35IxsiKxQG7nUgCpUB5SIsNxMntCNlTK9sMEBgmlkgnY0iXNlY3AyNTZrMaEC24cdmzuGnWqSwF-8Hw2gbkAZDzMWW3LsHJfp_kDhy-GDdGNwgiMog3VkcIIeWH, bindAddr4=/ip4/0.0.0.0/udp/9000
Jul-31 13:36:28.134[network]          info: PeerId 16Uiu2HAmACcmCEXcgt3zCtJL2rqJZ2Mvdjh6U6fe26HgD2FoNRwW, Multiaddrs /ip4/0.0.0.0/tcp/9000
Jul-31 13:36:28.137[metrics]          info: Started metrics HTTP server address=http://127.0.0.1:8008
Jul-31 13:36:28.256[rest]             info: Started REST API server address=http://0.0.0.0:9596
Jul-31 13:36:28.257[]                 info: Searching peers - peers: 0 - slot: 9634080 - head: (slot -576) 0x9d88…d02a - exec-block: syncing(20426302 0xcec4…) - finalized: 0x7feb…c130:301045
Jul-31 13:36:36.461[execution]        info: Execution client is synced oldState=ONLINE, newState=SYNCED
Jul-31 13:36:53.019[]                 info: Syncing - 3.7 minutes left - 2.32 slots/s - slot: 9634082 - head: (slot -515) 0x792f…f8aa - exec-block: valid(20426365 0x58b1…) - finalized: 0x9d88…d02a:301047 - peers: 11
Jul-31 13:38:53.168[]                 info: Syncing - 11 seconds left - 4.01 slots/s - slot: 9634092 - head: (slot -44) 0x7491…f63e - exec-block: valid(20426841 0xd4b2…) - finalized: 0x1e00…6e6b:301062 - peers: 59
Jul-31 13:38:58.051[network]          info: Subscribed gossip core topics
Jul-31 13:38:58.132[sync]             info: Subscribed gossip core topics
Jul-31 13:39:05.001[]                 info: Synced - slot: 9634093 - head: 0x35de…1f0e - exec-block: valid(20426886 0x10ff…) - finalized: 0x88f8…5375:301063 - peers: 70
Jul-31 13:39:17.000[]                 info: Synced - slot: 9634094 - head: 0x7844…3b3e - exec-block: valid(20426887 0x67d1…) - finalized: 0x88f8…5375:301063 - peers: 69
Jul-31 13:39:29.000[]                 info: Synced - slot: 9634095 - head: 0x5516…ba12 - exec-block: valid(20426888 0x4ceb…) - finalized: 0x88f8…5375:301063 - peers: 74
```

### Check validators are detected and decrypted

> OPTIONAL: If you are running validators, you can check the validator client logs to ensure the validator keys exist, has been detected and decrypted.

Here is an example command if you are running validators on Goerli with the lodestar-quickstart script:

```
sudo docker logs goerli-validator
```

You should see something similar to:

```
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

:::info
It is normal to see `Error on getProposerDuties` in your validator logs as your beacon node and execution node sync up. Give it time.
:::

## Stop Containers

You can stop the running containers by using the `docker stop` command and apply it to more than one container if necessary.

```
sudo docker stop <CONTAINER NAME> <CONTAINER NAME 2>
```

Ensure to remove the container if you don't plan to restart it with the same parameters.

```
sudo docker rm <CONTAINER NAME> <CONTAINER NAME 2>
```

---

# Appendix

## Appendix A - Expanding the Logical Volume

There are cases where Ubuntu is provisioning only 200GB of a larger SSD causing users to run out of disk space when syncing their Eth1 node. The error message is similar to:

`Fatal: Failed to register the Ethereum service: write /var/lib/goethereum/geth/chaindata/383234.ldb: no space left on device`

To address this issue, assuming you have a SSD that is larger than 200GB, expand the space allocation for the LVM by following these steps:

```
sudo lvdisplay  <-- Check your logical volume size
sudo lvm
lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv
lvextend -l +100%FREE -r /dev/ubuntu-vg/ubuntu-lv
exit
sudo resize2fs /dev/ubuntu-vg/ubuntu-lv
df -h  <-- Check results
```

That should resize your disk to the maximum available space.

If you need support, please check with the [ChainSafe Discord](https://discord.gg/642wB3XC3Q) under the #:star2:-lodestar-general channel.

## Appendix B - Update client images

To update client images, you just need to stop all the containers, remove them and restart the lodestar-quickstart script to automatically check for new images.

You can stop the running containers by using the `docker stop` command with the container names.

```
sudo docker stop <CONTAINER NAME 1> <CONTAINER NAME 2> <CONTAINER NAME 3>
```

Remove the containers by using the `docker rm` command.

```
sudo docker rm <CONTAINER NAME 1> <CONTAINER NAME 2> <CONTAINER NAME 3>
```

Restart your containers using your [Startup Quickstart Script](#startup-quickstart-script) command.

---

## Full Disclaimer

This article (the guide) is for informational purposes only and does not constitute professional advice. The author does not warrant or guarantee the accuracy, integrity, quality, completeness, currency, or validity of any information in this article. All information herein is provided “as is” without warranty of any kind and is subject to change at any time without notice. The author disclaims all express, implied, and statutory warranties of any kind, including warranties as to accuracy, timeliness, completeness, or fitness of the information in this article for any particular purpose. The author is not responsible for any direct, indirect, incidental, consequential or any other damages arising out of or in connection with the use of this article or in reliance on the information available on this article. This includes any personal injury, business interruption, loss of use, lost data, lost profits, or any other pecuniary loss, whether in an action of contract, negligence, or other misuse, even if the author has been informed of the possibility.
