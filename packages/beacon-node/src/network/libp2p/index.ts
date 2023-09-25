import {PeerId} from "@libp2p/interface/peer-id";
import {Registry} from "prom-client";
import {ENR} from "@chainsafe/discv5";
import type {Components} from "libp2p/components";
import {identifyService} from "libp2p/identify";
import {bootstrap} from "@libp2p/bootstrap";
import {mdns} from "@libp2p/mdns";
import {createLibp2p} from "libp2p";
import {mplex} from "@libp2p/mplex";
import {yamux} from "@chainsafe/libp2p-yamux";
import {prometheusMetrics} from "@libp2p/prometheus-metrics";
import {tcp} from "@libp2p/tcp";
import {defaultNetworkOptions, NetworkOptions} from "../options.js";
import {Eth2PeerDataStore} from "../peers/datastore.js";
import {Libp2p} from "../interface.js";
import {createNoise} from "./noise.js";

export type NodeJsLibp2pOpts = {
  peerStoreDir?: string;
  disablePeerDiscovery?: boolean;
  metrics?: boolean;
  metricsRegistry?: Registry;
};

export async function getDiscv5Multiaddrs(bootEnrs: string[]): Promise<string[]> {
  const bootMultiaddrs = [];
  for (const enrStr of bootEnrs) {
    const enr = ENR.decodeTxt(enrStr);
    const multiaddrWithPeerId = (await enr.getFullMultiaddr("tcp"))?.toString();
    if (multiaddrWithPeerId) {
      bootMultiaddrs.push(multiaddrWithPeerId);
    }
  }
  return bootMultiaddrs;
}

export async function createNodeJsLibp2p(
  peerId: PeerId,
  networkOpts: Partial<NetworkOptions> = {},
  nodeJsLibp2pOpts: NodeJsLibp2pOpts = {}
): Promise<Libp2p> {
  const localMultiaddrs = networkOpts.localMultiaddrs || defaultNetworkOptions.localMultiaddrs;
  const {peerStoreDir, disablePeerDiscovery} = nodeJsLibp2pOpts;

  let datastore: undefined | Eth2PeerDataStore = undefined;
  if (peerStoreDir) {
    datastore = new Eth2PeerDataStore(peerStoreDir);
    await datastore.open();
  }

  const peerDiscovery = [];
  if (!disablePeerDiscovery) {
    const bootMultiaddrs = [
      ...(networkOpts.bootMultiaddrs ?? defaultNetworkOptions.bootMultiaddrs ?? []),
      // Append discv5.bootEnrs to bootMultiaddrs if requested
      ...(networkOpts.connectToDiscv5Bootnodes ? await getDiscv5Multiaddrs(networkOpts.discv5?.bootEnrs ?? []) : []),
    ];

    if ((bootMultiaddrs.length ?? 0) > 0) {
      peerDiscovery.push(bootstrap({list: bootMultiaddrs}));
    }

    if (networkOpts.mdns) {
      peerDiscovery.push(mdns());
    }
  }

  return createLibp2p({
    peerId,
    addresses: {
      listen: localMultiaddrs,
      announce: [],
    },
    connectionEncryption: [createNoise()],
    // Reject connections when the server's connection count gets high
    transports: [
      tcp({
        maxConnections: networkOpts.maxPeers,
        // socket option: the maximum length of the queue of pending connections
        // https://nodejs.org/dist/latest-v18.x/docs/api/net.html#serverlisten
        // it's not safe if we increase this number
        backlog: 5,
        closeServerOnMaxConnections: {
          closeAbove: networkOpts.maxPeers ?? Infinity,
          listenBelow: networkOpts.maxPeers ?? Infinity,
        },
      }),
    ],
    streamMuxers: [yamux({maxInboundStreams: 256}), mplex({maxInboundStreams: 256})],
    peerDiscovery,
    metrics: nodeJsLibp2pOpts.metrics
      ? prometheusMetrics({
          collectDefaultMetrics: false,
          preserveExistingMetrics: true,
          registry: nodeJsLibp2pOpts.metricsRegistry,
        })
      : undefined,
    connectionManager: {
      // dialer config
      maxParallelDials: 100,
      maxPeerAddrsToDial: 4,
      maxParallelDialsPerPeer: 2,
      dialTimeout: 30_000,

      // Rely entirely on lodestar's peer manager to prune connections
      //maxConnections: options.maxConnections,
      // DOCS: There is no way to turn off autodial other than setting minConnections to 0
      minConnections: 0,
      // the maximum number of pending connections libp2p will accept before it starts rejecting incoming connections.
      // make it the same to backlog option above
      maxIncomingPendingConnections: 5,
    },
    datastore,
    services: {
      identify: identifyService({
        agentVersion: networkOpts.private ? "" : networkOpts.version ? `lodestar/${networkOpts.version}` : "lodestar",
      }),
      // individual components are specified because the components object is a Proxy
      // and passing it here directly causes problems downstream, not to mention is slowwww
      components: (components: Components) => ({
        peerId: components.peerId,
        events: components.events,
        addressManager: components.addressManager,
        peerStore: components.peerStore,
        upgrader: components.upgrader,
        registrar: components.registrar,
        connectionManager: components.connectionManager,
        transportManager: components.transportManager,
        connectionGater: components.connectionGater,
        contentRouting: components.contentRouting,
        peerRouting: components.peerRouting,
        datastore: components.datastore,
        connectionProtector: components.connectionProtector,
        metrics: components.metrics,
      }),
    },
  });
}
