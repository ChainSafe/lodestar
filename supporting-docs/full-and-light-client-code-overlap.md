Last edited: 18/07/19

# Lodestar Full Client <> Light Client Architecture

## Abstract
This document outlines the structural differences between the Lodestar Full Client and Light Client. Clear distinctions will be made on the overlap between the two clients and how they share related packages. A description of each package is provided, in plain english (non-technical) where possible.


## Directory Structure
The following is the current directory structure for the Lodestar Full Client. Beside every directory is a hyphen with an acknowledgement whether or not Light Client will utilse it. The client is written in such a way that every directory is considered to be its own exportable module. For those that know Golang, the client mimics the package directory structure. This was planned months in advance in order to ensure that code can easily be shared between Lodestar tools and future devtooling tools alike. Modularity is key.
```
packages/lodestar/src
├── chain - no
├── cli - potentially
├── config - needed
├── constants - needed
├── db - needed
├── eth1 - needed
├── logger - needed
├── network - potentially
├── node - no
├── opPool - no
├── params - needed
├── rpc - needed
├── sszTypes - needed 
├── sync - potnetially
├── types - needed 
├── util - potentially
└── validator - no
```

## Module Definitions
- **Chain:** The chain module contains the ETH2.0 consensus rules. This isn't used by the Light Client, but because the spec is frozen, and we are already at the latest version v0.8, there is very little to change here.
- **CLI:** The CLI is the command line interface. There is a little overlap surrounding ETH1.x deposits. The added overhead of maintaining it is low regardless, since all the main commands already exist.
- **Config:** Config contains the blockchain configurations that allow us to customize the chain for both testing and production needs. The Light Client will need to use these.
- **Constants:** Similar to config, it contains the required constants from the ETH2.0 specification that will be needed in the Light Client
- **DB:** The db is the chain database, it is used to store information about the blockchain. The Light Client will utilize a subset of this package.
- **ETH1:** This is used to do two things: generate eth1.x deposits (uses the deposit contract to simulate the genesis event) and to read from the deposits to store them accordingly. The Light Client will need this to simulate the genesis event.
- **Logger:** Logger is a custom debugging tool that allows us to output information to the terminal. The Light Client would use this as well to keep everything uniform.
- **Network:** Network is where all the networking communications happen. Libp2p and hobbits are integrated into this module. There is a potential use case for this in the Light Client. Regardless, development of this module will continue for the benefit of the Libp2p ecosystem because we maintain Gossipsub-js.
- **Node:** This module sets up the Full Client and starts all the necessary services. It will not be used by the light client.
- **opPool:** This module contains special instructions to help facilitate commands across the Full Client. The Light Client will use this.
- **Params:** Similar to config and constants, this contains necessary variables that will be utilized across the entire ETH2.0 Javascript ecosystem.
- **RPC:** RPC stands for remote procedure calls. These are used to help facilitate communications between Full Clients, Validators and Light Clients. They will be used in the Light Client.
- **sszTypes:** Similar to config, params and constants this contains necessary variables that will be utilized across the entire ETH2.0 Javascript ecosystem.
- **Sync:** This contains the Full Client sync strategy, since the Light Client uses a different sync strategy this module will not be used directly. Although the interfaces may be used to maintain consistency in the Light Client.
- **Types:** Similar to config, sszTypes, params and constants, this contains necessary variables that will be utilized across the entire ETH2.0 Javascript ecosystem.
- **Util:** This module contains random functions that don't quite have a home in any specific module and are shared across the entire project. There is a good chance that we will utilize some of these within the Light Client.
- **Validator:** This contains the code for running an ETH2.0 validator. It is primarily finished, and shares a significant amount of code from the rest of the Lodestar packages discussed. It will not be used by the Light Client.
