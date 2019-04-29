import {EventEmitter} from "events";
import {Service} from "../node";
import {LodestarNode} from "./node";
import {logger} from "../logger";
import {PeerInfo} from "peer-info";
import LibP2p from "libp2p";
import {PeerBook} from "peer-book";
import {promisify} from "promisify-es6";

export interface P2pOptions {
  maxPeers: number,
  refreshInterval: number,
  peerBook: PeerBook,
  bootnodes: any[]
}

/**
 * The P2PNetwork service manages p2p connection/subscription objects
 */
export class P2PNetwork extends EventEmitter implements Service {

  private options: P2pOptions;

  private started: boolean;

  private node: LibP2p;

  private discoveredPeers: Set<any>;

  private log: logger;

  public constructor(opts: P2pOptions) {
    super();
    this.options = opts;
    this.started = false;
    this.node = null;
    this.discoveredPeers = new Set();
    this.log = logger;
  }

  get isRunning() {
    return this.started;
  }

  public async start(): Promise<void> {
    if (this.started) {
      throw new Error("P2P Network already started");
    }

    if (!this.node) {
      this.node = new LodestarNode({
        peerInfo: await this.createPeerInfo(),
        bootnodes: this.options.bootnodes
      });

      // TODO: Add protocol handling for RPC over Libp2p

      this.node.on('peer:discovery', async (peerInfo) => {
        try {
          const peerId = peerInfo.id.toB58String();
          // Check if peer has already been discovered
          if (this.options.peerBook.has(peerId) || this.discoveredPeers.has(peerId)) {
            return;
          }
          this.options.peerBook.put(peerInfo);
          this.node.dial(peerInfo, () => {
          });
          this.log.info(`Peer discovered: ${peerInfo}`);
          this.emit('connected', peerInfo);
        } catch (err) {
          this.log(err);
        }

      });

      this.node.on('peer:connect', async (peerInfo) => {
        try {
          this.log.info(`Peer connected: ${peerInfo}`);
          this.options.peerBook.put(peerInfo);
          this.discoveredPeers.add(peerInfo);
        } catch (err) {
          this.log.error(err);
        }
      });

      this.node.on('peer:disconnect', async (peerInfo) => {
        try {
          this.options.peerBook.remove(peerInfo);
          this.discoveredPeers.delete(peerInfo);
        } catch (err) {
          this.log.error(err);
        }
      });
    }
    await promisify(this.node.start.bind(this.node))();

    this.started = true;
  }

  public async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.node.removeAllListeners();
    await promisify(this.node.stop.bind(this.node))();
  }

  private async createPeerInfo(): PeerInfo {
    return null;
  }
}
