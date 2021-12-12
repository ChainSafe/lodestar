# Easy script to join the merge devnet(s)
This is a setup to run and join the devnet with a single shell command. This script will pull the appropriate images and config and spin up the EL client and lodestar.
###### Requirements
1. docker
2. git
3. A bash shell

###### Just run the script with arguments
```bash
cd kintsugi/devnets
./setup.sh --dataDir devnet3data --elClient nethermind --devnetVars ./devnet3.vars --dockerWithSudo
```
###### Script parameters help

1. `dataDir`: Where you want the script and client's configuration data to be setup. Should be non-existent for the first run. (The directory if already present will skip fetching the configuration, assuming it has done previously). You can also clean indivizual directories of CL/EL between the re-runs.
2. `elClient`: Which EL client you want, currently working with nethermind
3. `devnetVars`: Contains the configuration specific to a devnet, like images, or urls for EL/CL to interact. Will be updated with new vars.
4. `dockerWithSudo`: provide this argument if your docker needs a sudo prefix
