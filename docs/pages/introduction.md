# Introduction

Ethereum is one of the most profoundly important inventions in recent history. It is a decentralized, open-source blockchain featuring smart contract functionality. It is the second-largest cryptocurrency by market capitalization, after Bitcoin, and is the second largest blockchain by market capitalization. Ethereum was proposed in 2013 by programmer Vitalik Buterin. Development was crowdfunded in 2014, and the network went live on 30 July 2015, with 72 million coins premined. ChainSafe was founded not too long afterwards in 2017 and has been actively working in the Ethereum ecosystem ever since. We are proud to develop Lodestar, the only TypeScript based consensus client, and to present this documentation as a resource for the Ethereum community.

## Proof of Stake

In Ethereum's Proof of Stake (PoS) model, validators replace miners from the Proof of Work (PoW) system. Validators are Ethereum stakeholders who lock up a portion of their Ether as a stake. The protocol randomly selects these validators to propose new blocks. The chance of being chosen is tied to the size of their stake: the more Ether staked, the higher the probability of being selected to propose the block. Proposers receive transaction fees and block rewards as incentives. Validators are also responsible for voting on the validity of blocks proposed by other validators. However, they also face penalties, known as slashing, for actions like signing two different block proposals in the same slot or voting on two different attestations for the same target epoch, which creates conflicting states. The PoS mechanism significantly reduces energy consumption compared to PoW, because it does not require extensive computational power. Moreover, PoS tends to facilitate faster transaction validations and block creations, enhancing the overall performance and scalability of the network.

## Consensus Clients

In an effort to promote client diversity there are several consensus beacon nodes being developed. Each is programmed in a different language and by a different team. The following is a list of the current open source consensus clients in alphabetical order:

- [Grandine (Rust)](https://grandine.io)
- [Lighthouse (Rust)](https://lighthouse.sigmaprime.io/)
- [Lodestar (TypeScript)](https://lodestar.chainsafe.io/)
- [Nimbus (Nim)](https://nimbus.team/)
- [Prysm (Golang)](https://prysmaticlabs.com/)
- [Teku (Java)](https://consensys.net/knowledge-base/ethereum-2/teku/)

## Why Client Diversity?

The Ethereum network's robustness is significantly enhanced by its client diversity, whereby multiple, independently-developed clients conforming to a common specification, facilitating seamless interaction and function equivalently across different nodes. This client variety not only fosters a rich ecosystem but also provides a buffer against network-wide issues stemming from bugs or malicious attacks targeted at particular clients. For instance, during the Shanghai denial-of-service attack in 2016, the diversified client structure enabled the network to withstand the assault, underscoring the resilience afforded by multiple client configurations.

On the consensus layer, client distribution is crucial for maintaining network integrity and finality, ensuring transactions are irreversible once validated. A balanced spread of nodes across various clients help to mitigate risks associated with potential bugs or attacks that could, in extreme cases, derail the consensus process (liveness failure) or lead to incorrect chain splits (forking), thereby jeopardizing the network's stability and trust. While the data suggests a [dominance of the Prysm and Lighthouse clients](https://clientdiversity.org) on the consensus layer, efforts are ongoing to promote a more even distribution among others clients. Encouraging the adoption of minority clients, bolstering their documentation, and leveraging real-time client diversity dashboards are among the strategies being employed to enhance client diversity, which in turn fortifies the Ethereum consensus layer against adversities and fosters a healthier decentralized network.

The [non-finality event of May 2023](https://medium.com/offchainlabs/post-mortem-report-ethereum-mainnet-finality-05-11-2023-95e271dfd8b2) on the Ethereum network posed a significant challenge. The issue arose from attestations for a fork, which necessitated state replays to validate the attestations, causing a notable strain on system resources. As a result, nodes fell out of sync, which deterred the accurate tracking of the actual head of the chain. This situation was exacerbated by a decline in attestations during specific epochs, further hampering the consensus mechanism from reaching finality. The Lodestar team noticed late attestations several weeks prior to the event and implemented a feature that attempted to address such challenges by not processing untimely attestations, and thus not requiring expensive state replays​. While it was done for slightly different reasons, the result was the same. Lodestar was able to follow the chain correctly and helped to stabilize the network. This example underscored the importance of client diversity and network resilience against potential forks and replay attacks. These are considered realistic threats, especially in the context of system complexity like in Ethereum's consensus mechanism.

## Ethereum Reading List

- [Ethereum Docs](https://ethereum.org/en/developers/docs/)
- [Upgrading Ethereum](https://eth2book.info/capella/) by Ben Edgington
- [Ethereum Book](https://github.com/ethereumbook/ethereumbook) by Andreas M. Antonopoulos and Gavin Wood
- [Ethereum Consensus Specification](https://github.com/ethereum/consensus-specs)
- [Casper the Friendly Finality Gadget](https://browse.arxiv.org/pdf/1710.09437.pdf) by Vitalik Buterin and Virgil Griffith
- [LMD Ghost](https://github.com/protolambda/lmd-ghost) by protolambda
