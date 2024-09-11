import {PrivateKey} from "@libp2p/interface";
import {Registry} from "prom-client";
import {ENR} from "@chainsafe/enr";
import {identify} from "@libp2p/identify";
import {bootstrap} from "@libp2p/bootstrap";
import {mdns} from "@libp2p/mdns";
import {createLibp2p} from "libp2p";
import {mplex} from "@libp2p/mplex";
import {prometheusMetrics} from "@libp2p/prometheus-metrics";
import {tcp} from "@libp2p/tcp";
import {noise} from "@chainsafe/libp2p-noise";
import {defaultNetworkOptions, NetworkOptions} from "../options.js";
import {Eth2PeerDataStore} from "../peers/datastore.js";
import {Libp2p, LodestarComponents} from "../interface.js";

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
  privateKey: PrivateKey,
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
    privateKey,
    addresses: {
      listen: localMultiaddrs,
      announce: [],
    },
    connectionEncrypters: [noise()],
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
    streamMuxers: [mplex({maxInboundStreams: 256})],
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
      dialTimeout: 30_000,
      // the maximum number of pending connections libp2p will accept before it starts rejecting incoming connections.
      // make it the same to backlog option above
      maxIncomingPendingConnections: 5,
    },
    // rely on lodestar's peer manager to ping peers
    connectionMonitor: {
      enabled: false,
    },
    datastore,
    services: {
      identify: identify({
        agentVersion: networkOpts.private ? "" : networkOpts.version ? `lodestar/${networkOpts.version}` : "lodestar",
        runOnConnectionOpen: false,
      }),
      // individual components are specified because the components object is a Proxy
      // and passing it here directly causes problems downstream, not to mention is slowwww
      components: (components: LodestarComponents) => ({
        peerId: components.peerId,
        privateKey: components.privateKey,
        nodeInfo: components.nodeInfo,
        logger: components.logger,
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
