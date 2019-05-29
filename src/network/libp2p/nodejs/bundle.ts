/**
 * @module network/libp2p/nodejs
 */

import libp2p from "libp2p";
import TCP from "libp2p-tcp";
import Mplex from "libp2p-mplex";
import Bootstrap from "libp2p-bootstrap";
import PeerInfo from "peer-info";
import deepmerge from "deepmerge";

import {isPlainObject} from "../../../util/objects";

export interface Libp2pOptions {
  peerInfo: PeerInfo;
  bootnodes?: string[];
}

export class NodejsNode extends libp2p {
  public constructor(options: Libp2pOptions) {
    const defaults = {
      modules: {
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
