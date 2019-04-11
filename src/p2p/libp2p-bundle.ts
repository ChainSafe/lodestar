import {libp2p} from "libp2p";
import {TCP} from "libp2p-tcp";
import {Mplex} from "libp2p-mplex";
import {Bootstrap} from "libp2p-bootstrap";
import {WStar} from "libp2p-webrtc-star";
import {waterfall} from "async/waterfall";
import {PeerInfo} from "peer-info";
import {defaultsDeep} from "@nodeutils/defaults-deep";
import {promisify} from "promisify-es6";

export class LodestarNode extends libp2p {
  constructor(_options: object) {
    const wrtcStar = new WStar({ id: _options.peerInfo.id });

    const defaults = {
      modules: {
        transport: [TCP, wrtcStar],
	streamMuxer: [Mplex],
	peerDiscovery: [Bootstrap, wrtcStar.discovery]
      },
      config: {
        peerDiscovery: {
          bootstrap: {
            interval: 2000,
            enabled: true,
            list: _options.bootstrap || []
          }
        }
      }
    };

    super(defaultsDeep(_options, defaults));
  }

  static async createNode (callback) {
    var node: LodestarNode;

    const peerInfo = await promisify(PeerInfo.create(callback));
    // Opens a tcp socket at port 9000. Will change
    peerInfo.multiaddrs.add('ip4/0.0.0.0/tcp/9000');
    node = new LodestarNode({
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

