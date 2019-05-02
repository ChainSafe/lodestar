import LibP2p from "libp2p";
import {TCP} from "libp2p-tcp";
import {Mplex} from "libp2p-mplex";
import {Bootstrap} from "libp2p-bootstrap";
import {promisify} from "es6-promisify";
import {PeerInfo} from "peer-info";
import {PeerId} from "peer-id";
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
    const id = promisify(PeerId.create)({bits: 1024});
    const peerInfo = promisify(PeerInfo.create)(id);
    peerInfo.multiaddrs.add('ip4/0.0.0.0/tcp/9000');
    const node = new LodestarNode({
      peerInfo
    });

    node.pubsub = new FloodSub(node);

    return node;
  }

	public async start(): Promise<void> {
    await promisify(super.start.bind(this))();
    await promisify(this.pubsub.start.bind(this.pubsub))();
  }
}

