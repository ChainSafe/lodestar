# Networking

Lodestar will automatically connect to peers on the network. Peers are found through the discv5 protocol and once peers are established communications happen via gossipsub over libp2p. While not necessary, having a basic understanding of how the various protocols and transports work will help with debugging and troubleshooting as some of the more common challenges come up with [firewalls](#firewall-management) and [NAT traversal](#nat-traversal).

## Networking Flags

Some of the important Lodestar flags related to networking are:

- [`--discv5`](./beacon-cli.md#-discv5)
- [`--listenAddress`](./beacon-cli.md#-listenaddress)
- [`--port`](./beacon-cli.md#-port)
- [`--discoveryPort`](./beacon-cli.md#-discoveryport)
- [`--listenAddress6`](./beacon-cli.md#-listenaddress6)
- [`--port6`](./beacon-cli.md#-port6)
- [`--discoveryPort6`](./beacon-cli.md#-discoveryport6)
- [`--bootnodes`](./beacon-cli.md#-bootnodes)
- [`--deterministicLongLivedAttnets`](./beacon-cli.md#-deterministiclonglivedattnets)
- [`--subscribeAllSubnets`](./beacon-cli.md#-subscribeallsubnets)
- [`--disablePeerScoring`](./beacon-cli.md#-disablepeerscoring)
- [`--enr.ip`](./beacon-cli.md#-enrip)
- [`--enr.tcp`](./beacon-cli.md#-enrtcp)
- [`--enr.udp`](./beacon-cli.md#-enrudp)
- [`--enr.ip6`](./beacon-cli.md#-enrip6)
- [`--enr.tcp6`](./beacon-cli.md#-enrtcp6)
- [`--enr.udp6`](./beacon-cli.md#-enrudp6)
- [`--nat`](./beacon-cli.md#-nat)
- [`--private`](./beacon-cli.md#`-private`)

## Peer Discovery (Discv5)

In Ethereum, discv5 plays a pivotal role in the peer discovery process, facilitating nodes to find and locate each other in order to form the peer-to-peer network​. The process begins with an interaction between new nodes and bootnodes at start-up. Bootnodes are nodes with hard-coded addresses, or can be overridden via the cli flag [`--bootnodes`](./beacon-cli.md#-bootnodes), to bootstrap the discovery process​. Through a method called FINDNODE-NODES, a new node establishes a bond with each bootnode, and it returns a list of peers for the new node to connect to. Following this trail, the new node engages through FINDNODE-NODES with the provided peers to further establish a web of connections​.

Discv5 operates as a peer advertisement medium in this network, where nodes can act as both providers and consumers of data. Every participating node in the Discv5 protocol discovers peer data from other nodes and later relays it, making the discovery process dynamic and efficient​.

Discv5 is designed to be a standalone protocol running via UDP on a dedicated port solely for peer discovery. Peer data is exchanged via self-certified, flexible peer records (ENRs). These key features cater to the Ethereum network​ and being a good peer often means running a discv5 worker​. Lodestar offers simple configuration to setup and run a bootnode independently of a beacon node. See the [bootnode cli](../bootnode/bootnode-cli.md) page for more information and configuration options.

## ENR

Ethereum Node Records (ENRs) are a standardized format utilized for peer discovery - see [EIP-778](https://eips.ethereum.org/EIPS/eip-778) for the specification. An ENR consists of a set of key-value pairs. These pairs include crucial information such as the node's ID, IP address, the port on which it's listening, and the protocols it supports. This information helps other nodes in the network locate and connect to the node.

The primary purpose of ENRs is to facilitate node discovery and connectivity in the Ethereum network. Nodes use ENRs to announce their presence and capabilities to other nodes, making it easier to establish and maintain a robust, interconnected network.

Note that bootnodes are announced via ENR.

Lodestar prints out its own ENR on startup, the logs will show something similar to the following

```txt
info: discv5 worker started peerId=16Uiu...t9LQ3, initialENR=enr:-Iu4QGE...WRwgiMo, bindAddr4=/ip4/0.0.0.0/udp/9000
```

Alternatively, the ENR can also be retrieved from the beacon node API by querying the [getNetworkIdentity](https://ethereum.github.io/beacon-APIs/#/Node/getNetworkIdentity) endpoint.

[ENR Viewer](https://enr-viewer.com/) provides a simple and convenient option to decode and inspect ENRs.

## Peer Communication (gossipsub and ReqResp)

Gossipsub and ReqResp are the two mechanisms that beacon nodes use to exchange chain data. Gossipsub is used disseminate the most recent relevant data proactively throughout the network. ReqResp is used to directly ask specific peers for specific information (eg: during syncing).

### Gossipsub

GossipSub is a foundational protocol in peer-to-peer (P2P) communication, particularly decentralized networks like Ethereum and IPFS. At its core, GossipSub efficiently propagates data, filtered by topic, through a P2P network. It organizes peers into a collection of overlay networks, each associated with a distinct topic. By routing data through relevant overlay networks based on topics of interest, large amounts of data can be efficiently disseminated without excessive bandwidth, latency, etc.

In GossipSub, nodes can subscribe to topics, effectively joining the corresponding overlay to receive messages published to a specific topic. This topic-based structure enables nodes to congregate around shared interests, ensuring that relevant messages are delivered to all interested parties. Each message published to a topic gets disseminated and relayed to all subscribed peers, similar to a chat room.

Messages are propagated through a blend of eager-push and lazy-pull models. Specifically, the protocol employs "mesh links" to carry full messages actively and "gossip links" to carry only message identifiers (lazy-pull propagation model). This hybrid approach allows for both active message propagation and reactive message retrieval​ which is an extension of the traditional hub-and-spoke pub/sub model.

### ReqResp

ReqResp is the domain of protocols that establish a flexible, on-demand mechanism to retrieve historical data and data missed by gossip. This family of methods, implemented as separate libp2p protocols, operate between a single requester and responder. A method is initiated via a libp2p protocol ID, with the initiator sending a request message and the responder sending a response message. Every method defines a specific request and response message type, and a specific protocol ID. This framework also facilitates streaming responses and robust error handling.

## Data Transport (libp2p)

Libp2p is a modular and extensible network stack that serves as the data transport layer below both gossipsub and ReqResp and facilitates the lower-level peer-to-peer communications. It provides a suite of protocols for various networking functionalities including network transports, connection encryption and protocol multiplexing. Its modular design allows for the easy addition, replacement, or upgrading of protocols, ensuring an adaptable and evolving networking stack.

Libp2p operates at the lower levels of the OSI model, particularly at the Transport and Network layers. Libp2p supports both TCP and UDP protocols for establishing connections and data transmission. Combined with libp2p's modular design it can integrate with various networking technologies to facilitating both routing and addressing.

## Firewall Management

If your setup is behind a firewall there are a few ports that will need to be opened to allow for P2P discovery and communication. There are also some ports that need to be protected to prevent unwanted access or DDOS attacks on your node.

Ports that must be opened:

- 30303/TCP+UDP - Execution layer P2P communication port
- 9000/TCP+UDP - Beacon node IPv4 P2P communication port
- 9090/TCP+UDP - Beacon node IPv6 P2P communication port

Ports that must be protected:

- 9596/TCP - Beacon node REST API port
- 5062/TCP - Validator key manager API port
- 18550/TCP - MEV-Boost/Builder port
- 8008/TCP - Beacon node metrics port
- 5064/TCP - Validator metrics port
- 8545/TCP - Execution client JSON RPC port
- 8551/TCP - Execution engine port for Lodestar to communicate with the execution client

## NAT Traversal

Lodestar does not support UPnP. If you are behind a NAT you will need to manually forward the ports listed above.
