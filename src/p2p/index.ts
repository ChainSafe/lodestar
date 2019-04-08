import {EventEmitter} from "events";
import {LodestarNode} from "node";

const defaultOpts = {
  // logger
  maxPeers: 25,
  refreshInterval: 15000,
  multiaddrs: ['/ip4/127.0.0.1/tcp/9000'],
  key: null,
  bootnodes: []
};

/**
 * The P2PNetwork service manages p2p connection/subscription objects
 */
export class P2PNetwork extends EventEmitter {
  public constructor(opts) {
    super();
    options = { ...defaultOpts, ..opt};

    this.maxPeers = options.maxPeers;
    this.refreshInterval = options.refreshInterval;
    this.started = false;
    this.multiaddrs = opts.multiaddrs;
    this.key = opts.key;
    this.bootnodes = opts.bootnodes;
    this.node = null;
    this.peers = new Map();
  }

  get isRunning () {
    return this.started;
  }

  public async start() {
    if (this.started) {
      throw new Error("P2P Network already started");
    }

    if (!this.node) {
      this.node new LodestarNode({
        peerInfo: await this.createPeerInfo(),
	bootnodes: this.bootnodes
      });

      this.node.on('peer:discovery', async (peerInfo) => {
      
      });

      this.node.on('peer:connect', async (peerInfo) => {
      
      });

    }

    this.started = true;
  }
  public async stop() {
    this.started = false;
    // TODO: Add logger
  }

  public async createPeerInfo() {
  
  }
}
