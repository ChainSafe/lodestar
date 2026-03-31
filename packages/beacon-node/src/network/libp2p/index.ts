import {bootstrap} from "@libp2p/bootstrap";
import {identify} from "@libp2p/identify";
import type {PrivateKey} from "@libp2p/interface";
import {mdns} from "@libp2p/mdns";
import {mplex} from "@libp2p/mplex";
import {prometheusMetrics} from "@libp2p/prometheus-metrics";
import {tcp} from "@libp2p/tcp";
import {Libp2pInit, createLibp2p} from "libp2p";
import {Registry} from "prom-client";
import {ENR} from "@chainsafe/enr";
import {noise} from "@chainsafe/libp2p-noise";
import {asCrypto, defaultCrypto} from "@chainsafe/libp2p-noise/crypto";
import {quic} from "@chainsafe/libp2p-quic";
import {Libp2p, LodestarComponents} from "../interface.js";
import {NetworkOptions, defaultNetworkOptions} from "../options.js";
import {Eth2PeerDataStore} from "../peers/datastore.js";

export type NodeJsLibp2pOpts = {
  peerStoreDir?: string;
  disablePeerDiscovery?: boolean;
  metrics?: boolean;
  metricsRegistry?: Registry;
};

export async function getDiscv5Multiaddrs(bootEnrs: string[], quicEnabled?: boolean): Promise<string[]> {
  const bootMultiaddrs = [];
  for (const enrStr of bootEnrs) {
    const enr = ENR.decodeTxt(enrStr);
    // Prefer QUIC over TCP when available
    const quicMultiaddr = quicEnabled ? (await enr.getFullMultiaddr("quic"))?.toString() : undefined;
    const tcpMultiaddr = (await enr.getFullMultiaddr("tcp"))?.toString();
    const multiaddrWithPeerId = quicMultiaddr ?? tcpMultiaddr;
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
  const disconnectThreshold = networkOpts.disconnectThreshold ?? defaultNetworkOptions.disconnectThreshold;
  const tcpEnabled = networkOpts.tcp ?? defaultNetworkOptions.tcp;
  const quicEnabled = networkOpts.quic ?? defaultNetworkOptions.quic;
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
      ...(networkOpts.connectToDiscv5Bootnodes
        ? await getDiscv5Multiaddrs(networkOpts.discv5?.bootEnrs ?? [], quicEnabled)
        : []),
    ];

    if ((bootMultiaddrs.length ?? 0) > 0) {
      peerDiscovery.push(bootstrap({list: bootMultiaddrs}));
    }

    if (networkOpts.mdns) {
      peerDiscovery.push(mdns());
    }
  }
  const transports: Libp2pInit["transports"] = [];
  if (tcpEnabled) {
    transports.unshift(
      tcp({
        // Reject connections when the server's connection count gets high
        maxConnections: networkOpts.maxPeers,
        // socket option: the maximum length of the queue of pending connections
        // https://nodejs.org/dist/latest-v18.x/docs/api/net.html#serverlisten
        // it's not safe if we increase this number
        backlog: 5,
        closeServerOnMaxConnections: {
          closeAbove: networkOpts.maxPeers ?? Infinity,
          listenBelow: networkOpts.maxPeers ?? Infinity,
        },
      })
    );
  }
  if (quicEnabled) {
    const quicMultiaddrs = localMultiaddrs.filter((ma) => ma.includes("/quic-v1"));
    const hasIpv4Quic = quicMultiaddrs.some((ma) => ma.includes("/ip4/"));
    const hasIpv6Quic = quicMultiaddrs.some((ma) => ma.includes("/ip6/"));
    // Only add QUIC transport if at least one QUIC listen address is configured,
    // otherwise the transport constructor will throw
    if (hasIpv4Quic || hasIpv6Quic) {
      transports.unshift(
        quic({
          handshakeTimeout: 5_000,
          maxIdleTimeout: 10_000,
          keepAliveInterval: 5_000,
          maxConcurrentStreamLimit: 256,
          maxStreamData: 10_000_000,
          maxConnectionData: 15_000_000,
          ipv4: hasIpv4Quic,
          ipv6: hasIpv6Quic,
        })
      );
    }
  }

  const noiseCrypto = {
    ...defaultCrypto,
  };
  if (globalThis.Bun) {
    noiseCrypto.chaCha20Poly1305Decrypt = asCrypto.chaCha20Poly1305Decrypt;
    noiseCrypto.chaCha20Poly1305Encrypt = asCrypto.chaCha20Poly1305Encrypt;
  }

  return createLibp2p({
    privateKey,
    nodeInfo: {
      name: "lodestar",
      version: networkOpts.version ?? "unknown",
      userAgent: networkOpts.private ? "" : networkOpts.version ? `lodestar/${networkOpts.version}` : "lodestar",
    },
    addresses: {
      listen: localMultiaddrs,
      announce: [],
    },
    connectionEncrypters: [noise({crypto: noiseCrypto})],
    transports,
    streamMuxers: [mplex({disconnectThreshold})],
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
    // for our purposes, we don't want peer store data to expire
    // see https://github.com/libp2p/js-libp2p/pull/3019
    peerStore: {
      maxAddressAge: Infinity,
      maxPeerAge: Infinity,
    },
    datastore,
    services: {
      identify: identify({
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
