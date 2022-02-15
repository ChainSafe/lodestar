/**
 * @module network/nodejs
 */

import LibP2p from "libp2p";
import TCP from "libp2p-tcp";
import Mplex from "libp2p-mplex";
import {NOISE} from "@chainsafe/libp2p-noise";
import Bootstrap from "libp2p-bootstrap";
import MDNS from "libp2p-mdns";
import PeerId from "peer-id";
import {Datastore} from "interface-datastore";

export interface ILibp2pOptions {
  peerId: PeerId;
  addresses: {
    listen: string[];
    announce?: string[];
  };
  datastore?: Datastore;
  peerDiscovery?: (typeof Bootstrap | typeof MDNS)[];
  bootMultiaddrs?: string[];
  maxConnections?: number;
  minConnections?: number;
}

export class NodejsNode extends LibP2p {
  constructor(options: ILibp2pOptions) {
    super({
      peerId: options.peerId,
      addresses: {
        listen: options.addresses.listen,
        announce: options.addresses.announce || [],
      },
      modules: {
        connEncryption: [NOISE],
        transport: [TCP],
        streamMuxer: [Mplex],
        peerDiscovery: options.peerDiscovery || [Bootstrap, MDNS],
      },
      dialer: {
        maxParallelDials: 100,
        maxAddrsToDial: 4,
        maxDialsPerPeer: 2,
        dialTimeout: 30_000,
      },
      connectionManager: {
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
      peerStore: {
        persistence: !!options.datastore,
        threshold: 10,
      },
      config: {
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
        peerDiscovery: {
          autoDial: false,
          mdns: {
            peerId: options.peerId,
          },
          bootstrap: {
            enabled: !!(options.bootMultiaddrs && options.bootMultiaddrs.length),
            interval: 2000,
            list: (options.bootMultiaddrs || []) as string[],
          },
        },
      },
    });
  }
}
