import {createLibp2p} from "libp2p";
import {identifyService} from "libp2p/identify";
import {tcp} from "@libp2p/tcp";
import {mplex} from "@libp2p/mplex";
import {bootstrap} from "@libp2p/bootstrap";
import {mdns} from "@libp2p/mdns";
import {PeerId} from "@libp2p/interface-peer-id";
import {Datastore} from "interface-datastore";
import type {PeerDiscovery} from "@libp2p/interface-peer-discovery";
import type {Components} from "libp2p/components";
import {prometheusMetrics} from "@libp2p/prometheus-metrics";
import {Registry} from "prom-client";
import {Libp2p} from "../interface.js";
import {createNoise} from "./noise.js";

export type Libp2pOptions = {
  peerId: PeerId;
  addresses: {
    listen: string[];
    announce?: string[];
  };
  datastore?: Datastore;
  peerDiscovery?: ((components: Components) => PeerDiscovery)[];
  bootMultiaddrs?: string[];
  maxConnections?: number;
  minConnections?: number;
  metrics?: boolean;
  metricsRegistry?: Registry;
  lodestarVersion?: string;
  hideAgentVersion?: boolean;
  mdns?: boolean;
};

export async function createNodejsLibp2p(options: Libp2pOptions): Promise<Libp2p> {
  const peerDiscovery = [];
  if (options.peerDiscovery) {
    peerDiscovery.push(...options.peerDiscovery);
  } else {
    if ((options.bootMultiaddrs?.length ?? 0) > 0) {
      peerDiscovery.push(bootstrap({list: options.bootMultiaddrs ?? []}));
    }
    if (options.mdns) {
      peerDiscovery.push(mdns());
    }
  }
  return createLibp2p({
    peerId: options.peerId,
    addresses: {
      listen: options.addresses.listen,
      announce: options.addresses.announce || [],
    },
    connectionEncryption: [createNoise()],
    // Reject connections when the server's connection count gets high
    transports: [
      tcp({
        maxConnections: options.maxConnections,
        closeServerOnMaxConnections: {
          closeAbove: options.maxConnections ?? Infinity,
          listenBelow: options.maxConnections ?? Infinity,
        },
      }),
    ],
    streamMuxers: [mplex({maxInboundStreams: 256})],
    peerDiscovery,
    metrics: options.metrics
      ? prometheusMetrics({
          collectDefaultMetrics: false,
          preserveExistingMetrics: true,
          registry: options.metricsRegistry,
        })
      : undefined,
    connectionManager: {
      // dialer config
      maxParallelDials: 100,
      maxPeerAddrsToDial: 4,
      maxParallelDialsPerPeer: 2,
      dialTimeout: 30_000,

      // DOCS: the maximum number of connections libp2p is willing to have before it starts disconnecting.
      // If ConnectionManager.size > maxConnections calls _maybeDisconnectOne() which will sort peers disconnect
      // the one with the least `_peerValues`. That's a custom peer generalized score that's not used, so it always
      // has the same value in current Lodestar usage.
      maxConnections: options.maxConnections,
      // DOCS: There is no way to turn off autodial other than setting minConnections to 0
      minConnections: 0,
    },
    datastore: options.datastore,
    services: {
      identify: identifyService({
        agentVersion: options.hideAgentVersion
          ? ""
          : options.lodestarVersion
          ? `lodestar/${options.lodestarVersion}`
          : "lodestar",
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
