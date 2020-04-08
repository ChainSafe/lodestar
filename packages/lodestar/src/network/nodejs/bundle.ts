/**
 * @module network/nodejs
 */

import LibP2p from "libp2p";
import TCP from "libp2p-tcp";
import Mplex from "libp2p-mplex";
import {NOISE} from "libp2p-noise";
import SECIO from "libp2p-secio";
import Bootstrap from "libp2p-bootstrap";
import MDNS from "libp2p-mdns";
import PeerInfo from "peer-info";
import {Discv5Discovery} from "../discovery/discv5";
import {ENR} from "@chainsafe/discv5";
import Multiaddr from "multiaddr";


export interface ILibp2pOptions {
  peerInfo: PeerInfo;
  discv5: {
    bindAddr: Multiaddr;
    enr: ENR;
    bootEnrs?: ENR[];
  };
  bootnodes?: string[];
}

export class NodejsNode extends LibP2p {
  public constructor(options: ILibp2pOptions) {
    const defaults = {
      peerInfo: options.peerInfo,
      modules: {
        connEncryption: [NOISE, SECIO],
        transport: [TCP],
        streamMuxer: [Mplex],
        peerDiscovery: [
          Bootstrap,
          MDNS,
          Discv5Discovery,
        ],
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
          autoDial: true,
          mdns: {
            peerInfo: options.peerInfo
          },
          bootstrap: {
            interval: 2000,
            enabled: true,
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
    // @ts-ignore
    super(defaults);
  }
}
