# Introduction

Ethereum is one of the most profoundly important inventions in recent history.  It is a decentralized, open-source blockchain featuring smart contract functionality.  It is the second-largest cryptocurrency by market capitalization, after Bitcoin, and is the most actively used blockchain.  Ethereum was proposed in 2013 by programmer Vitalik Buterin.  Development was crowdfunded in 2014, and the network went live on 30 July 2015, with 72 million coins pre-mined.  ChainSafe was founded not too long afterwards and has been actively working in the Ethereum space ever since.  We are proud to develop Lodestar and to present this documentation as a resource for the Ethereum community.

## Proof of Stake

Proof-of-Stake (PoS) is a type of consensus mechanism utilized by blockchain networks to achieve agreement among various nodes on the validity of transactions. Unlike its predecessor, Proof-of-Work (PoW), which requires nodes to perform complex mathematical calculations, PoS relies on the amount of cryptocurrency a node holds as a stake. The more stake a node holds, the higher its chances of being chosen to validate a new block of transactions on the blockchain. This system encourages honesty among participants, as any fraudulent activity could lead to the loss of their staked coins, providing a form of security for the network.

PoS is often lauded for its energy efficiency compared to PoW. Since it doesn't require extensive computational power, it significantly reduces the energy consumption, making it a more eco-friendly alternative. Moreover, PoS tends to facilitate faster transaction validations and block creations, enhancing the overall performance and scalability of the network. Over time, several variations of PoS have emerged, including Delegated Proof of Stake (DPoS) and Leased Proof Of Stake (LPoS), each with its unique features and benefits aimed at improving blockchain network functionality and governance. Through these advancements, PoS continues to evolve, fostering a more sustainable and efficient environment for decentralized applications and systems.

## Consensus Clients

In an effort to promote client diversity there are several beacon-nodes being developed.  Each is programmed in a different language and by a different team.  The following is a list of the current beacon-node clients:

[Lodestar](https://chainsafe.io/lodestar.html)
[Prysm](https://prysmaticlabs.com/)
[Lighthouse](https://lighthouse.sigmaprime.io/)
[Teku](https://consensys.net/knowledge-base/ethereum-2/teku/)
[Nimbus](https://nimbus.team/)

## Why Client Diversity?

The Ethereum network's robustness is significantly enhanced by its client diversity, whereby multiple, independently-developed clients conforming to a common specification facilitate seamless interaction and function equivalently across nodes. This client variety not only fosters a rich ecosystem but also provides a buffer against network-wide issues stemming from bugs or malicious attacks targeted at particular clients. For instance, during the Shanghai denial-of-service attack in 2016, the diversified client structure enabled the network to withstand the assault, underscoring the resilience afforded by multiple client configurations.

On the consensus layer, client distribution is crucial for maintaining network integrity and finality, ensuring transactions are irreversible once validated. A balanced spread of nodes across various clients helps mitigate risks associated with potential bugs or attacks that could, in extreme cases, derail the consensus process or lead to incorrect chain splits, thereby jeopardizing the network's stability and trust. While the data suggests a dominance of Prysm client on the consensus layer, efforts are ongoing to promote a more even distribution among others like Lighthouse, Teku, and Nimbus. Encouraging the adoption of minority clients, bolstering their documentation, and leveraging real-time client diversity dashboards are among the strategies being employed to enhance client diversity, which in turn fortifies the Ethereum consensus layer against adversities and fosters a healthier decentralized network ecosystem.

The non-finality event in May 2023 on the Ethereum network posed a significant challenge. The issue arose from attestations for a fork, which necessitated state replays to validate the attestations, causing a notable strain on system resources. As a result, nodes fell out of sync, which deterred the accurate tracking of the actual head of the chain. This situation was exacerbated by a decline in attestations during specific epochs, further hampering the consensus mechanism. The Lodestar team noticed late attestations several weeks prior to the event and implemented a feature that attempted to address such challenges by not processing untimely attestations, and thus not requiring expensive state replays​.  While it was done for slightly different reasons, the result was the same.  Lodestar was able to follow the chain correctly and helped to stabilize the network.  This example underscored the importance of client diversity and network resilience against potential forks and replay attacks.  These are considered realistic threats, especially in the context of system complexity like in Ethereum's consensus mechanism.

## Ethereum Reading List

- [Ethereum Docs](https://ethereum.org/en/developers/docs/)
- [Upgrading Ethereum](https://eth2book.info/capella/) by Ben Edgington
- [Ethereum Book](https://github.com/ethereumbook/ethereumbook) by Andreas M. Antonopoulos and Gavin Wood
- [Ethereum Consensus Specification](https://github.com/ethereum/consensus-specs)
- [Casper the Friendly Finality Gadget](https://browse.arxiv.org/pdf/1710.09437.pdf) by Vitalik Buterin and Virgil Griffith
- [LMD Ghost](https://github.com/protolambda/lmd-ghost) by protolambda