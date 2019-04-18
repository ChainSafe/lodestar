'use strict';

import Libp2p from "libp2p";
import TCP from "libp2p-tcp";
import Mplex from "libp2p-mplex";
import Bootstrap from "libp2p-bootstrap";
import WStar from "libp2p-webrtc-star";
import KadDHT from "libp2p-kad-dht";
import defaultsDeep from "@nodeutils/defaults-deep";

class LodestarNode extends Libp2p {
  public constructor(_options: Libp2p.OptionsConfig) {
    const wrtcStar = new WStar({ id: _options.peerInfo.id });

    const defaults = {
      modules: {
        transport: [TCP, wrtcStar],
        streamMuxer: [Mplex],
        peerDiscovery: [Bootstrap, wrtcStar.discovery],
        dht: KadDHT
      },
      config: {
        peerDiscovery: {
          bootstrap: {
            interval: 2000,
            enabled: true,
            list: _options.bootstrap || []
          }
        },
        dht: {
	  enabled: true,
	  kBucketSize: 20
        },
        EXPERIMENTAL: {
          pubsub: true
        }
      }
    };

    super(defaultsDeep(_options, defaults));
  }
}

export { LodestarNode };
