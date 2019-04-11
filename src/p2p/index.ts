import {EventEmitter} from "events";
import {Service} from "../node";
import {LodestarNode} from "./";
import {debug} from "debug";
import {PeerBook} from "peer-book";
import {promisify} from "promisify-es6";

const defaultOpts = {
  maxPeers: 25,
  refreshInterval: 15000,
  peerBook: new PeerBook(),
  bootnodes: []
};

/**
 * The P2PNetwork service manages p2p connection/subscription objects
 */
export class P2PNetwork extends EventEmitter implements Service {
  public constructor(opts) {
    super();
    options = { ...defaultOpts, ...opts};

    this.maxPeers = options.maxPeers;
    this.refreshInterval = options.refreshInterval;
    this.started = false;
    this.peerBook = opts.peerBook;
    this.bootnodes = opts.bootnodes;
    this.node = null;
    this.discoveredPeers = new Set();

    this.log = debug('p2p');
  }

  get isRunning () {
    return this.started;
  }

  public async start() {
    if (this.started) {
      throw new Error("P2P Network already started");
    }

    if (!this.node) {
      this.node = new LodestarNode({
        peerInfo: await this.createPeerInfo(),
	bootnodes: this.bootnodes
      });

      // TODO: Add protocol handling for RPC over Libp2p

      this.node.on('peer:discovery', async (peerInfo) => {
        try {
	  const peerId = peerInfo.id.toB58String();
	  // Check if peer has already been discovered
	  if (this.peerBook.has(peerId) || this.discoveredPeers.has(peerId)) {
	    return;
	  }
	  peerBook.put(peerInfo);
	  this.node.dial(peerInfo, () => {});
	  this.log(`Peer discovered: ${peerInfo}`);
	  this.emit('connected', peerInfo);
	} catch (err) {
	  this.log(err);
	} 

      });

      this.node.on('peer:connect', async (peerInfo) => {
        try {
          this.log(`Peer connected: ${peerInfo}`);
	  this.peerBook.put(peerInfo);
	  this.discoveredPeers.add(peerInfo);
	} catch (err) {
	  this.log(err);
	}
      });

      this.node.on('peer:disconnect', async (peerInfo) => {
        try {
	  this.peerBook.remove(peerInfo);
          this.discoveredPeers.delete(peerInfo);
	} catch (err) {
	  this.log(err);
	}
      });
    }
    let startNode = promisify(this.node.start.bind(this.node))();

    this.started = true;
  }
  public async stop() {
    if (!this.started) {
      return false;
    }

    await new Promise((resolve, reject) => this.node.stop((err) => {
      if (err) {
        reject(err);
      }
      resolve();
    }));
  }
}
