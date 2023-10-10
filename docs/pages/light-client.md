# Lodestar Light Client

Ethereum light clients provide a pathway for users to interact with the Ethereum blockchain in a trust-minimized manner, comparable to the level of trust required when engaging with a third-party provider like Infura or EtherScan. Not that those platforms are bad, but trust in any centralized provider goes against the ethos of blockchain.  Light clients are a way that low-power devices, like cell phones, can do self validation of transactions and dApp state.

Unlike full nodes, light clients do not download and store the entire blockchain. Instead, they download only the headers of each block and employ Merkle proofs to verify transactions.  This enables a quick synchronization with the network and access the latest information without using significant system resources​. This streamlined approach to accessing Ethereum is crucial, especially in scenarios where full-scale network participation is infeasible or undesired.

The evolution of light clients is emblematic of the broader trajectory of Ethereum towards becoming more accessible and resource-efficient, making blockchain technology more inclusive and adaptable to a wide array of use cases and environments.  The Altair hard fork introduced sync committees to allow light-clients to synchronize to the network.

## Requirements for Running a Light-Client

Access to an beacon node that supports the light client specification is necessary.

System requirements are quite low so its possible to run a light client in the browser as part of a website. There are a few examples of this on github that you can use as reference, our [prover](./prover.md) being one of them.

## Light-Client Flags



## Notes (DELETE THESE BEFORE MERGING) 
RPC calls to verify transactions.  To communicate with the execution client one either needs a valid access JWT or an unrestricted node.  As an example our [prover](./prover.md) communicates with MetaMask to make RPC calls.