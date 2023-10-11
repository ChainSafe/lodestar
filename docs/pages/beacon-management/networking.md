# Networking

Starting up Lodestar will automatically connect it to peers on the network. Peers are found through the discv5 protocol and one peers are established communications happen via gossipsub over libp2p. While not necessary, having a basic understanding of how the various protocols and transport work will help with debugging and troubleshooting as some of the more common challenges come up with [firewalls](#firewall-management) and [NAT traversal](#nat-traversal).

## Networking Flags

Some of the important Lodestar flags related to networking are:

- [`--discv5`](./configuration.md#--discv5)
- [`--listenAddress`](./configuration.md#--listenAddress)
- [`--port`](./configuration.md#--port)
- [`--discoveryPort`](./configuration.md#--discoveryPort)
- [`--listenAddress6`](./configuration.md#--listenAddress6)
- [`--port6`](./configuration.md#--port6)
- [`--discoveryPort6`](./configuration.md#--discoveryPort6)
- [`--bootnodes`](./configuration.md#--bootnodes)
- [`--deterministicLongLivedAttnets`](./configuration.md#--deterministicLongLivedAttnets)
- [`--subscribeAllSubnets`](./configuration.md#--subscribeAllSubnets)
- [`--disablePeerScoring`](./configuration.md#--disablePeerScoring)
- [`--enr.ip`](./configuration.md#--enr.ip)
- [`--enr.tcp`](./configuration.md#--enr.tcp)
- [`--enr.udp`](./configuration.md#--enr.udp)
- [`--enr.ip6`](./configuration.md#--enr.ip6)
- [`--enr.tcp6`](./configuration.md#--enr.tcp6)
- [`--enr.udp6`](./configuration.md#--enr.udp6)
- [`--nat`](./configuration.md#--nat)
- [``--private``](./configuration.md#`--private`)

## Peer Discovery (Discv5)

In Ethereum, discv5 plays a pivotal role in the peer discovery process, facilitating nodes to find and locate each other in order to form the peer-to-peer network​. The process begins with an interaction between new nodes and bootnodes at start-up. Bootnodes are nodes with hardcoded addresses, or are provided via the cli flag `--bootnodes`, to bootstrap the discovery process​. Through a method called PING-PONG, a new node establishes a bond with each bootnode, and it returns a list of peers for the new node to connect to. Following this trail, the new node engages through PING-PONG with the provided peers to further establish a web of connections​.

Discv5 operates as an advertisement medium in this network, where nodes can act as both providers and consumers of data. Every participating node in the Discv5 protocol can accept topic ads from other nodes and later relay them, making the discovery process dynamic and efficient​.

Discv5 is designed to be a standalone protocol running via UDP on a dedicated port solely for peer discovery. It supports self-certified, flexible peer records (ENRs) and topic-based advertisement. These key features cater to the Ethereum network​ and being a good peer often means running a discv5 worker​. Lodestar offers simple configuration to setup and run a bootnode alongside the beacon node. See [bootnode](./bootnode.md) for more information and configuration options.

## ENR

Ethereum Node Records (ENRs) are a standardized format utilized for network addressing and they replace the older formats of multiaddr and enodes. It facilitates a more comprehensive informational exchange between nodes compared to its predecessors. Each ENR contains a signature, a sequence number, and fields that detail the identity scheme used to generate and validate signatures. This identity scheme is pivotal for ensuring the authenticity and integrity of the information being exchanged between nodes.

The primary objective behind ENRs is to aid nodes in discovering each other through the node discovery. This protocol relays vital identity information, including public keys (on the secp256k1 curve), IP addresses, and two port numbers for establishing connections and interactions between nodes on the network. Note that bootnodes are announced via ENR.

## Peer Communication (gossibsub and ReqResp)

Gossipsub and ReqResp are sort of two sides of the same coin. Gossipsub is used to propagate messages throughout the network and ReqResp is used by peers on the network to directly communicate the specific of that information as it crisscrosses the web of connections.

### Gossipsub

GossipSub is a foundational protocol in peer-to-peer (P2P) communication, particularly decentralized networks like Ethereum and IPFS. At its core, GossipSub organizes a collection of P2P overlays, each associated with a distinct topic. These overlays represent the network topology formed by interconnected nodes on the network, allowing for efficient dissemination based on topics of interest​.

In GossipSub, nodes can subscribe to topics, effectively joining the corresponding overlay to receive messages published to a specific topic. This topic-based structure enables nodes to congregate around shared interests, ensuring that relevant messages are delivered to all interested parties. Each message published to a topic gets disseminated and relayed to all subscribed peers, similar to a chat room.

Messages are propagated through a blend of eager-push and lazy-pull models. Specifically, the protocol employs "mesh links" to carry full messages actively and "gossip links" to carry only message identifiers (lazy-pull propagation model). This hybrid approach allows for both active message propagation and reactive message retrieval​ which is an extension of the traditional hub-and-spoke pub/sub model.

### ReqResp

ReqResp is a protocol that speak specifically to the messages that are gossipped between peers. It is a domain that entails a collection of method protocols that enable nodes to engage in bilateral communications. This domain operates over a single libp2p Protocol ID, with each specific method having its own versioning. The methods within this domain are invoked with a request message and the peer on the other end of the wire responds with an appropriately formed response message.

Within the ReqResp domain, every method defines a specific request and response message type, alongside a protocol ID. The protocol IDs are crucial as they enable nodes to decode and encode messages appropriately. More importantly, ReqResp's design facilitates robust error handling, ensuring that the network remains resilient and effectively propagating essential information among beacon nodes.

## Data Transport (libp2p)

Libp2p is a modular and extensible network stack that serves as the data transport layer below both gossipsub and ReqResp and facilitates the lower-level peer-to-peer communications. It provides a suite of protocols for various networking functionalities including peer discovery, content routing, and protocol multiplexing. Its modular design allows for the easy addition, replacement, or upgrading of protocols, ensuring an adaptable and evolving networking stack.

Libp2p operates at the lower levels of the OSI model, particularly at the Transport and Network layers. Libp2p supports both TCP and UDP protocols for establishing connections and data transmission. Combined with libp2p's modular design it can integrate with various networking technologies to facilitating both routing and addressing.

## Firewall Management

If your setup is behind a firewall there are a few ports that will need to be opened to allow for P2P discovery and communication. There are also some ports that need to be protected to prevent unwanted access or DDOS attacks on your node.

Ports that should be opened:

- 30303/TCP+UDP - Execution layer p2p communication port
- 9000/TCP+UDP - Beacon Node P2P communication port
- 9090/TCP - Lodestar IPv6 P2P communication port
- 13000/TCP - Prysm P2P communication port
- 12000/UDP - Prysm P2P communication port

Ports that should be fully (inbound/outbound) protected:

- 9596/TCP - Lodestar Beacon-Node JSON RPC api calls
- 5062/TCP - Lodestar validator key manager api calls
- 18550/TCP - Lodestar MEV Boost/Builder port
- ****** - Metrics
- ****** - Metrics
- ****** - Metrics
- 8545/TCP - Execution client JSON RPC port for api calls
- 8551/TCP - Execution engine port for Lodestar to communicate with the execution client

## NAT Traversal

Lodestar does not support UPnP. If you are behind a NAT you will need to manually forward the ports listed above.

