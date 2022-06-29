# Easy script to join the Ethereum networks

This is a setup to run and join the merge devnets, testnets (and mainnet soon!)  with a single shell command. This script will pull the appropriate images and config and spin up the EL client and lodestar.

This script is borne out of need to simplify putting together the various moving parts of the post merge ethereum setup so that the users can have super fast onboarding, easy switch/test EL clients as well as can take inspiration for how to match/debug the configurations for their customized setups.

So just give it a go and fire away your merge setup command!

### Supported Networks

Look for the .vars file in the folder to see what networks are supported. Here are a few examples

1. Kiln Network ( soon to be deprecated ):  `--devnetVars ./kiln.vars`
2. Ropsten Network: `--devnetVars ./ropsten.vars`
3. Sepolia Network: `--devnetVars ./sepolia.vars`
4. Mainnet Shadow fork 8: `--devnetVars ./mainnetshadow-8.vars`

#### And the much awaited Mainnet merge!

Comming soon! but you can start prepping your nodes with `--devnetVars mainnet.vars` with a placeholder TTD.

### Requirements

1. docker
2. git
3. A bash shell

### Just run the script with arguments

```bash
cd merge-scripts
./setup.sh --dataDir kiln-data --elClient geth --devnetVars ./kiln.vars [--dockerWithSudo --withTerminal "gnome-terminal --disable-factory --" --withValidator]
```

### Example scenarios

1. Run with separate terminals launched & attached (best for testing in local) :
   `./setup.sh --dataDir kiln-data --elClient nethermind --devnetVars ./kiln.vars --withTerminal "gnome-terminal --disable-factory --" --dockerWithSudo `
2. Run _in-terminal_ attached with logs interleaved (best for testing in remote shell) :
   `./setup.sh --dataDir kiln-data --elClient nethermind --devnetVars ./kiln.vars --dockerWithSudo`
3. Run detached (best for leaving it to run, typically after testing 1 or 2):
   `./setup.sh --dataDir kiln-data --elClient nethermind --devnetVars ./kiln.vars --detached --dockerWithSudo`

### Supported EL clients

Look for the .vars file in the folder to see what networks are supported. Here are a few examples

1. Geth:  `--elClient geth`
2. Nethermind: `--elClient nethermind`
3. Besu: `--elClient besu`
4. Ethereumjs: (might sync only small size testnets for now): `--elClient ethereumjs`


You can alternate between them (without needing to reset/cleanup) to experiment with the ELs being out of sync ( and catching up) with `lodestar` via **Optimistic Sync** features.

### Script parameters help

1. `dataDir`: Where you want the script and client's configuration data to be setup. Should be non-existent one for the first run. (The directory if already present will skip fetching the configuration, assuming it has done previously). You can also clean indivizual directories of CL/EL between the re-runs.
2. `elClient`: Which EL client you want, currently working with `geth` and `nethermind`
3. `devnetVars`: Contains the configuration specific to a devnet, like images, or urls for EL/CL to interact. Will be updated with new vars.
4. `dockerWithSudo`(optional): Provide this argument if your docker needs a sudo prefix
5. `--withTerminal`(optional): Provide the terminal command prefix for CL and EL processes to run in your favourite terminal.
   You may use an alias or a terminal launching script as long as it waits for the command it runs till ends and then closes.If not provided, it will launch the docker processes in _in-terminal_ mode.
6. `--detached`(optional): By default the script will wait for processes and use user input (ctrl +c) to end the processes, however you can pass this option to skip this behavior and just return, for e.g. in case you just want to leave it running.
7. `--withValidator` (optional): Launch a validator client using `LODESTAR_VALIDATOR_ARGS` as set in the devnet vars file.
8. `--justEL | --justCL | --justVC` (optional) : Just launch only EL client or lodestar beacon or lodestar validator at any given time. Gives you more control over the setup.
9. `--skipImagePull` (optional): Just work with local images, don't try updating them.

Only one of `--withTerminal` or `--detached` should be provided.
