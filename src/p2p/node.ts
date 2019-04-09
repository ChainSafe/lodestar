import {libp2p} from "libp2p";
import {TCP} from "libp2p-tcp";
import {Mplex} from "libp2p-mplex";
import {Bootstrap} from "libp2p-bootstrap";
import {waterfall} from "async/waterfall";
import {PeerInfo} from "peer-info";
import {defaultsDeep} from "@nodeutils/defaults-deep";

export class LodestarNode extends libp2p {
  constructor(_options: object) {
    const defaults = {
      modules: {
        transport: [TCP],
	streamMuxer: [Mplex],
        peerDiscovery: [Bootstrap]
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

    waterfall([
      (cb) => PeerInfo.create(cb),
      (peerInfo, cb) => {
        peerInfo.multiaddrs.add('/ip4/0.0.0.0/tcp/9000');
	node = new LodestarNode({
          peerInfo
	});
	node.start(cb);
      }
      ], (err) => callback(err, node)
    );

    node.pubsub = new FloodSub(node);
    node.pubsub.start((err) => {
      if (err) { 
        throw new Error('PubSub failed to start.');
      }
    })

    return node;
  }
}

