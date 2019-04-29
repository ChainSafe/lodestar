import LibP2p from "libp2p";
import {TCP} from "libp2p-tcp";
import {Mplex} from "libp2p-mplex";
import {Bootstrap} from "libp2p-bootstrap";
import {waterfall} from "async/waterfall";
import {PeerInfo} from "peer-info";
import {defaultsDeep} from "@nodeutils/defaults-deep";
import * as FloodSub from "libp2p-floodsub";

export interface LodestarNodeOpts {
  bootstrap?: any[],
  peerInfo: PeerInfo,
  bootnodes?: any[]
}

export class LodestarNode extends LibP2p {

  private pubsub: FloodSub;

  private constructor(_options: LodestarNodeOpts) {
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

  public static async createNode(callback) {
    let node: LodestarNode;

    waterfall([
        (cb) => PeerInfo.create(cb),
        (peerInfo, cb) => {
          peerInfo.multiaddrs.add('/ip4/0.0.0.0/tcp/9000');
          node = new LodestarNode({
            peerInfo
          });
          (node as LibP2p).start(cb);
        }
      ], (err) => callback(err, node)
    );

    node.pubsub = new FloodSub(node);
    node.pubsub.start((err) => {
      if (err) {
        throw new Error('PubSub failed to start.');
      }
    });

    return node;
  }
}

