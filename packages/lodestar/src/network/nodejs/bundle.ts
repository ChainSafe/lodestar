/**
 * @module network/nodejs
 */

import LibP2p from "libp2p";
import TCP from "libp2p-tcp";
import Mplex from "libp2p-mplex";
import {NOISE} from "libp2p-noise";
import Bootstrap from "libp2p-bootstrap";
import MDNS from "libp2p-mdns";
import PeerId from "peer-id";
import {ENRInput, Discv5Discovery} from "@chainsafe/discv5";
import {Adapter} from "interface-datastore";


export interface ILibp2pOptions {
  peerId: PeerId;
  addresses: {
    listen: string[];
    announce?: string[];
    noAnnounce?: string[];
  };
  autoDial: boolean;
  datastore?: Adapter;
  discv5: {
    bindAddr: string;
    enr: ENRInput;
    bootEnrs?: ENRInput[];
  };
  peerDiscovery?: (typeof Bootstrap | typeof MDNS | typeof Discv5Discovery)[];
  bootnodes?: string[];
}

export class NodejsNode extends LibP2p {
  public constructor(options: ILibp2pOptions) {
    const defaults = {
      peerId: options.peerId,
      addresses: {
        listen: options.addresses.listen,
        announce: options.addresses.announce || [],
        noAnnounce: options.addresses.noAnnounce || []
      },
      modules: {
        connEncryption: [NOISE],
        transport: [TCP],
        streamMuxer: [Mplex],
        peerDiscovery: options.peerDiscovery || [
          Bootstrap,
          MDNS,
          Discv5Discovery,
        ],
      },
      datastore: options.datastore,
      peerStore: {
        persistence: !!options.datastore,
        threshold: 10
      },
      config: {
        relay: {
          enabled: false,
          hop: {
            enabled: false,
            active: false
          }
        },
        peerDiscovery: {
          autoDial: options.autoDial,
          mdns: {
            peerId: options.peerId
          },
          bootstrap: {
            enabled: !!(options.bootnodes && options.bootnodes.length),
            interval: 2000,
            list: (options.bootnodes || []) as string[],
          },
          discv5: {
            enr: options.discv5.enr,
            bindAddr: options.discv5.bindAddr,
            bootEnrs: options.discv5.bootEnrs || [],
          },
        }
      }
    };
    super(defaults);
  }
}
