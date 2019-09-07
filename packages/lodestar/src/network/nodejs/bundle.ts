/**
 * @module network/nodejs
 */

import LibP2p from "libp2p";
import TCP from "libp2p-tcp";
import Mplex from "libp2p-mplex";
import SECIO from "libp2p-secio";
import Bootstrap from "libp2p-bootstrap";
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
      modules: {
        connEncryption: [SECIO],
        transport: [TCP],
        streamMuxer: [Mplex],
        peerDiscovery: [Bootstrap],
      },
      config: {
        peerDiscovery: {
          bootstrap: {
            interval: 2000,
            enabled: true,
            list: [],
          }
        }
      }
    };
    super(deepmerge(defaults, options, {isMergeableObject: isPlainObject}));
  }
}
