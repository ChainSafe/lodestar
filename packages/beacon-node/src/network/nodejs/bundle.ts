import {createLibp2p, Libp2p} from "libp2p";
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
import {createNoise} from "./noise.js";

export interface ILibp2pOptions {
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
  mdns?: boolean;
}

export async function createNodejsLibp2p(options: ILibp2pOptions): Promise<Libp2p> {
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
  return await createLibp2p({
    peerId: options.peerId,
    addresses: {
      listen: options.addresses.listen,
      announce: options.addresses.announce || [],
    },
    connectionEncryption: [createNoise()],
    // Reject connections when the server's connection count gets high
    transports: [tcp({maxConnections: options.maxConnections})],
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
      maxAddrsToDial: 4,
      maxDialsPerPeer: 2,
      dialTimeout: 30_000,

      autoDial: false,
      // This is the default value, we reject connections based on tcp() option above so this is not important
      maxConnections: Infinity,
      // DOCS: the minimum number of connections below which libp2p not activate preemptive disconnections.
      // If ConnectionManager.size < minConnections, it won't prune peers in _maybeDisconnectOne(). If autoDial is
      // off it doesn't have any effect in behaviour.
      minConnections: options.minConnections,
    },
    datastore: options.datastore,
    nat: {
      // libp2p usage of nat-api is broken as shown in this issue. https://github.com/ChainSafe/lodestar/issues/2996
      // Also, unnsolicited usage of UPnP is not great, and should be customizable with flags
      enabled: false,
    },
    relay: {
      enabled: false,
      hop: {
        enabled: false,
        active: false,
      },
      advertise: {
        enabled: false,
        ttl: 0,
        bootDelay: 0,
      },
      autoRelay: {
        enabled: false,
        maxListeners: 0,
      },
    },

    identify: {
      host: {
        agentVersion: options.lodestarVersion ? `lodestar/${options.lodestarVersion}` : "lodestar",
      },
    },
  });
}
