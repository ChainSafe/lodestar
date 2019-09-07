/**
 * @module network/nodejs
 */

import LibP2p from "libp2p";
import TCP from "libp2p-tcp";
import Mplex from "libp2p-mplex";
import SECIO from "libp2p-secio";
import Bootstrap from "libp2p-bootstrap";
import MDNS from "libp2p-mdns";
import PeerInfo from "peer-info";
import deepmerge from "deepmerge";

import {isPlainObject} from "../../util/objects";

export interface Libp2pOptions {
  peerInfo: PeerInfo;
  bootnodes?: string[];
}

export class NodejsNode extends LibP2p {
  public constructor(options: Libp2pOptions) {
    const defaults = {
      peerInfo: options.peerInfo,
      modules: {
        connEncryption: [SECIO],
        transport: [TCP],
        streamMuxer: [Mplex],
        peerDiscovery: [Bootstrap, MDNS],
      },
      config: {
        peerDiscovery: {
          autoDial: true,
          mdns: {
          },
          bootstrap: {
            interval: 2000,
            enabled: true,
            list: (options.bootnodes || []) as any[],
          }
        }
      }
    };
    // @ts-ignore
    super(defaults);
  }
}
