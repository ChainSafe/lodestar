import LibP2p from "libp2p";
import {TCP} from "libp2p-tcp";
import {Mplex} from "libp2p-mplex";
import {Bootstrap} from "libp2p-bootstrap";
import {waterfall} from "async/waterfall";
import {PeerInfo} from "peer-info";
import {defaultsDeep} from "@nodeutils/defaults-deep";
import * as FloodSub from "libp2p-floodsub";

export interface LodestarNodeOpts {
  bootstrap?: string[];
  peerInfo: PeerInfo;
  bootnodes?: string[];
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

  public static createNode(callback): LodestarNode {
    let node: LodestarNode;

    const id = await promisify(PeerId.create)({ bits: 1024});
    const peerInfo = await promisify(PeerInfo.create)(id);
    peerInfo.multiaddrs.add('ip4/0.0.0.0/tcp/9000');
    const node = new LodestarNode({
      peerInfo
    });
    (node as LibP2p).start(callback);

    node.pubsub = new FloodSub(node);
    node.pubsub.start((err) => {
      if (err) {
        throw new Error('PubSub failed to start.');
      }
    });

    return node;
  }
}

