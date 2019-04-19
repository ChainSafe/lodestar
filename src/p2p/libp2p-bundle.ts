import {TCP} from "libp2p-tcp";
import {Mplex} from "libp2p-mplex";
import {Bootstrap} from "libp2p-bootstrap";
import {WStar} from "libp2p-webrtc-star";
import {KadDHT} from "libp2p-kad-dht";
import {PeerInfo} from "peer-info";
import {defaultsDeep} from "@nodeutils/defaults-deep";
import {promisify} from "promisify-es6";
import LibP2p from "libp2p";
import * as FloodSub from "libp2p-floodsub";
import {LodestarNodeOpts} from "./node";

export class LodestarNode2 extends LibP2p {
  constructor(_options: LodestarNodeOpts) {
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
	}
      }
    };

    super(defaultsDeep(_options, defaults));
  }

  static async createNode (callback) {
    var node: LibP2p;

    const peerInfo = await promisify(PeerInfo.create(callback));
    // Opens a tcp socket at port 9000. Will change
    peerInfo.multiaddrs.add('ip4/0.0.0.0/tcp/9000');
    peerInfo.multiaddrs.add('ip4/0.0.0.0/ws');
    node = new LodestarNode2({
      peerInfo
    });
    node.start(callback);

    node.pubsub = new FloodSub(node);
    node.pubsub.start((err) => {
      if (err) {
        throw new Error('PubSub failed to start.');
      }
    });
  }

}

