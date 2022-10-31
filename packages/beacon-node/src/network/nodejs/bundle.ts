import {createLibp2p, Libp2p} from "libp2p";
import {TCP} from "@libp2p/tcp";
import {Mplex} from "@libp2p/mplex";
import {Bootstrap} from "@libp2p/bootstrap";
import {MulticastDNS} from "@libp2p/mdns";
import {PeerId} from "@libp2p/interface-peer-id";
import {Datastore} from "interface-datastore";
import {Noise} from "@chainsafe/libp2p-noise";

export interface ILibp2pOptions {
  peerId: PeerId;
  addresses: {
    listen: string[];
    announce?: string[];
  };
  datastore?: Datastore;
  peerDiscovery?: (Bootstrap | MulticastDNS)[];
  bootMultiaddrs?: string[];
  maxConnections?: number;
  minConnections?: number;
  metrics?: boolean;
  lodestarVersion?: string;
}

export async function createNodejsLibp2p(options: ILibp2pOptions): Promise<Libp2p> {
  const peerDiscovery = [];
  if (options.peerDiscovery) {
    peerDiscovery.push(...options.peerDiscovery);
  } else {
    if ((options.bootMultiaddrs?.length ?? 0) > 0) {
      peerDiscovery.push(new Bootstrap({interval: 2000, list: options.bootMultiaddrs ?? []}));
    }
    peerDiscovery.push(new MulticastDNS());
  }
  return await createLibp2p({
    peerId: options.peerId,
    addresses: {
      listen: options.addresses.listen,
      announce: options.addresses.announce || [],
    },
    connectionEncryption: [new Noise()],
    transports: [new TCP()],
    streamMuxers: [new Mplex({maxInboundStreams: 256})],
    peerDiscovery,
    metrics: {
      // temporarily disable since there is a performance issue with it
      // see https://github.com/ChainSafe/lodestar/issues/4698
      enabled: false,
    },
    connectionManager: {
      // dialer config
      maxParallelDials: 100,
      maxAddrsToDial: 4,
      maxDialsPerPeer: 2,
      dialTimeout: 30_000,

      autoDial: false,
      // DOCS: the maximum number of connections libp2p is willing to have before it starts disconnecting.
      // If ConnectionManager.size > maxConnections calls _maybeDisconnectOne() which will sort peers disconnect
      // the one with the least `_peerValues`. That's a custom peer generalized score that's not used, so it always
      // has the same value in current Lodestar usage.
      maxConnections: options.maxConnections,
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
