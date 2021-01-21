## Lodestar monorepo dependency graph

This is a diagram of the various `lodestar-*` packages in the lodestar monorepo and how they fit together:

!!! info
    note: this dependency graph only applies to dependencies as they are used in the `src/` folders of each package, not in `test/`

```mermaid
graph TD
    lodestar["lodestar"]:::nodemodule
    cli["lodestar-cli"]:::nodemodule
    config["lodestar-config"]:::nodemodule
    db["lodestar-db"]:::nodemodule
    fork-choice["lodestar-fork-choice"]:::nodemodule
    params["lodestar-params"]:::nodemodule
    types["lodestar-types"]:::nodemodule
    utils["lodestar-utils"]:::nodemodule
    validator["lodestar-validator"]:::nodemodule
    state-trans["lodestar-beacon-state-transition"]:::nodemodule
    
    state-trans==>lodestar
    config==>lodestar
    db==>lodestar
    params==>lodestar
    types==>lodestar
    utils==>lodestar
    fork-choice==>lodestar
    
    config==>db
    utils==>db
    
    lodestar==>cli
    config==>cli
    types==>cli
    utils==>cli
    validator==>cli
    
    params==>types
    
    params==>config
    types==>config
    
    state-trans==>validator
    config==>validator
    types==>validator
    utils==>validator
    db==>validator
    
    state-trans==>fork-choice
    config==>fork-choice
    params==>fork-choice
    types==>fork-choice
    utils==>fork-choice
    
    config==>state-trans
    utils==>state-trans
    
    click cli "https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-cli"
    click lodestar "https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar"
    click validator "https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-validator"
    click db "https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-db"
    click params "https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-params"
    click state-trans "https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-beacon-state-transition"
    click fork-choice "https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-fork-choice"
    click types "https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-types"
    click utils "https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-utils"
    click config "https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-config"

    classDef nodemodule fill:grey,stroke-width:2px,stroke:black,color:white;
    linkStyle default stroke:grey, fill:none,stroke-width:1.5px;
```

For a list of all the packages in the monorepo and a description for each, click [here](https://github.com/ChainSafe/lodestar#packages).

Let's talk about how each package fits together in finer detail, from top to bottom, following the chart.

### @chainsafe/lodestar-params, @chainsafe/lodestar-types, @chainsafe/lodestar-config
[@chainsafe/lodestar-params](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-params) and [@chainsafe/lodestar-types](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-types) are combined together in [@chainsafe/lodestar-config](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-config).
Other packages use `lodestar-config` when a config object is needed.  We use config objects to perform any calculations specifically relevant to the beacon chain.  Without the config, we have no context for the data types or the network parameters that govern the Eth2 ecosystem.

### @chainsafe/lodestar-utils
[@chainsafe/lodestar-utils](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-utils) contains various utilities that are common among the various lodestar monorepo packages.

### @chainsafe/lodestar-beacon-state-transition
[@chainsafe/lodestar-beacon-state-transition](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-beacon-state-transition) contains the implementation of the [beacon state transition function](https://github.com/ethereum/eth2.0-specs/blob/v0.10.0/specs/phase0/beacon-chain.md#beacon-chain-state-transition-function), which is used by [`@chainsafe/lodestar`](#chainsafelodestar) to perform the actual beacon state transition.  This package also contains various functions used to calculate info about the beacon chain (such as `computeEpochAtSlot`) which are used by [@chainsafe/lodestar-fork-choice](#chainsafelodestar-fork-choice), [@chainsafe/lodestar-validator](#chainsafelodestar-validator)

### @chainsafe/lodestar-db
[@chainsafe/lodestar-db](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-db) is where all persistent data about the beacon node is stored.  Any package that needs to read or write persistent beacon node data depends on `lodestar-db`.

### @chainsafe/lodestar-fork-choice
[@chainsafe/lodestar-fork-choice](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-fork-choice) holds the fork choice graph.  The [`@chainsafe/lodestar`](#chainsafelodestar) package is the sole consumer of this package because the beacon node itself is what is reading/writing the fork choice DAG.  
For a good explainer on how the fork choice itself works, see the [annotated fork choice spec]([@chainsafe/lodestar](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar)).  This is an annotated version of the [Eth2 fork choice spec](https://github.com/ethereum/eth2.0-specs/blob/v0.12.1/specs/phase0/fork-choice.md) which `lodestar-fork-choice` is based on.

### @chainsafe/lodestar-validator
[@chainsafe/lodestar-validator](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-validator) contains the validator client.  The sole consumer of this package is [@chainsafe/lodestar-cli](#chainsafelodestarcli), which provides CLI access to run and configure the validator client.  However, the validator client connects to a REST API that is contained in [@chainsafe/lodestar](#chainsafelodestar) (specifically in the [`api` module](../architecture/#api)) to perform the validator duties.

### @chainsafe/lodestar
[@chainsafe/lodestar](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar) contains the actual beacon node process itself, which is the aggregate of all the above packages and the "brain" of the lodestar beacon chain implementation.  All of the [node modules](../architecture) live in this package as well.

### @chainsafe/lodestar-cli
[@chainsafe/lodestar-cli](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-cli) combines everything together for CLI usage and configuration of the beacon node and validator.