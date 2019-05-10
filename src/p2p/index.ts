/**
 * @module p2p
 */

import {EventEmitter} from "events";
import {Service} from "../node";
import {LodestarNode} from "./node";
import logger, {AbstractLogger} from "../logger";
import {PeerInfo} from "peer-info";
import LibP2p from "libp2p";
import {PeerBook} from "peer-book";
import {PeerId} from "peer-id";
import {promisify} from "promisify-es6";

export interface P2pOptions {
  maxPeers: number;
  refreshInterval: number;
  peerBook: PeerBook;
  privateKey: Buffer;
  bootnodes: string[];
}

/**
 * The P2PNetwork service manages p2p connection/subscription objects
 */
export class P2PNetwork extends EventEmitter implements Service {

  private options: P2pOptions;

  private maxPeers: number;

  private refreshInterval: number;

  private peerBook: PeerBook;

  private privateKey: Buffer;

  private bootnodes: string[];

  private started: boolean;

  private node: LibP2p;

  private discoveredPeers: Set<PeerInfo>;

  private log: AbstractLogger;

  public constructor(opts: P2pOptions) {
    super();
    this.options = opts;
    this.maxPeers = this.options.maxPeers;
    this.refreshInterval = this.options.refreshInterval;
    this.peerBook = this.options.peerBook;
    this.privateKey = this.options.privateKey;
    this.bootnodes = this.options.bootnodes;


    this.started = false;
    this.node = null;
    this.discoveredPeers = new Set();
    this.log = logger;
  }

  public get isRunning(): boolean {
    return this.started;
  }

  public async start(): Promise<void> {
    if (this.started) {
      throw new Error("P2P Network already started");
    }

    if (!this.node) {
      this.node = LodestarNode.createNode({
        peerInfo: await this.createPeerInfo(),
        bootnodes: this.options.bootnodes
      });

      this.node.on('peer:discovery', (peerInfo) => {
        try {
          const peerId = peerInfo.id.toB58String();
          // Check if peer has already been discovered
          if (this.options.peerBook.has(peerId) || this.discoveredPeers.has(peerId)) {
            return;
          }
          this.peerBook.put(peerInfo);
	  this.node.dial(peerInfo, () => {});
          this.log.info(`Peer discovered: ${peerInfo}`);
          this.emit('connected', peerInfo);
        } catch (err) {
          this.log.error(err);
        }

      });

      this.node.on('peer:connect', (peerInfo) => {
        try {
          this.log.info(`Peer connected: ${peerInfo}`);
          this.peerBook.put(peerInfo);
          this.discoveredPeers.add(peerInfo);
        } catch (err) {
          this.log.error(err);
        }
      });

      this.node.on('peer:disconnect', (peerInfo) => {
        try {
          this.peerBook.remove(peerInfo);
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
    return new Promise((resolve, reject) => {
      const handler = (err, peerInfo) => {
        if (err) {
	  return reject(err);
        }
        this.peerBook.getAll().forEach((peer) => {
	  peer.multiaddrs.forEach((multiaddr) => {
	    peerInfo.multiaddrs.add(multiaddr);
	    resolve(peerInfo);
	  });
        });
      };
      if (this.privateKey) {
        PeerId.createFromPrivKey(this.privateKey, (err, id) => {
	  if (err) {
	    return reject(err);
	  }
	  PeerInfo.create(id, handler);	  
        });
      } else {
        PeerInfo.create(handler);
      } 
    });
  }
}
