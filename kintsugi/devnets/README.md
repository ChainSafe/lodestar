# Easy script to join the merge devnet(s)
This is a setup to run and join the devnet with a single shell command. This script will pull the appropriate images and config and spin up the EL client and lodestar.
###### Requirements
1. docker
2. git
3. A bash shell

###### Just run the script with arguments
```bash
cd kintsugi/devnets
./setup.sh --dataDir devnet3-data --elClient nethermind --devnetVars ./devnet3.vars [--dockerWithSudo --withTerminal "gnome-terminal --disable-factory --"
```
###### Script parameters help

1. `dataDir`: Where you want the script and client's configuration data to be setup. Should be non-existent for the first run. (The directory if already present will skip fetching the configuration, assuming it has done previously). You can also clean indivizual directories of CL/EL between the re-runs.
2. `elClient`: Which EL client you want, currently working with nethermind
3. `devnetVars`: Contains the configuration specific to a devnet, like images, or urls for EL/CL to interact. Will be updated with new vars.
4. `dockerWithSudo`(optional): Provide this argument if your docker needs a sudo prefix
5. `--withTerminal`(optional): Provide the terminal command prefix for CL and EL processes to run in your favourite terminal. You may use an alias or a terminal launching script as long as it waits for the command it runs till ends and then closes.
If not provided, it will launch the docker processes in detached mode.
6. `--detached`(optional): By default the script will wait for processes and use user input (ctrl +c) to end the processes, however you can pass this option to skip this behavior and just return, for e.g. in case you just want to leave it running.

Only one of `--withTerminal` or `--detached` should be provided.
