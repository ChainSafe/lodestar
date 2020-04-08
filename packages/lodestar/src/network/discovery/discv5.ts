import {EventEmitter} from "events";
import randombytes from "randombytes";
import PeerInfo from "peer-info";
import Multiaddr from "multiaddr";
import {
  Discv5,
  ENR,
  createNodeId,
} from "@chainsafe/discv5";

export interface IDiscv5DiscoveryInputOptions {
  enr: ENR;
  bindAddr: string;
  bootEnrs: ENR[];
}

export interface IDiscv5DiscoveryOptions extends IDiscv5DiscoveryInputOptions {
  peerInfo: PeerInfo;
}

/**
 * Discv5Discovery
 */
export class Discv5Discovery extends EventEmitter {
  static tag = "discv5";

  private discv5: Discv5;
  private started: NodeJS.Timer | boolean;

  constructor(options: IDiscv5DiscoveryOptions) {
    super();
    this.discv5 = Discv5.create(options.enr, options.peerInfo.id, Multiaddr(options.bindAddr));
    options.bootEnrs.forEach((bootEnr) => this.discv5.addEnr(bootEnr));
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    await this.discv5.start();
    setTimeout(() => this.findPeers, 1);
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.started = false;
    await this.discv5.stop();
  }

  async findPeers(): Promise<void> {
    while (!this.started) {
      // Search for random nodes
      // emit discovered on all finds
      const enrs = await this.discv5.findNode(createNodeId(randombytes(32)));
      if (!this.started) {
        return;
      }
      for (const enr of enrs) {
        try {
          const peerInfo = new PeerInfo(await enr.peerId());
          const multiaddrTCP = enr.multiaddrTCP;
          if (multiaddrTCP) {
            peerInfo.multiaddrs.add(multiaddrTCP);
          }
          this.emit("peer", peerInfo);
        } catch (e) {
          continue;
        }
      }
    }
  }
}
