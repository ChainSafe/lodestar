import {EventEmitter} from "events";
import {Service} from "../node";
import {LodestarNode} from "./node";
import logger, {AbstractLogger} from "../logger";
import {PeerInfo} from "peer-info";
import LibP2p from "libp2p";
import {pull} from "pull-stream";
import {PeerBook} from "peer-book";
import {PeerId} from "peer-id";
import {promisify} from "promisify-es6";
import {Hello, Goodbye} from "../rpc/api/wire/messages";
import {DB} from "../db";
import {BeaconChain} from "../chain";

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

  private chain: BeaconChain;

  private db: DB;

  public constructor(opts: P2pOptions, {chain, db}) {
    super();
    this.options = opts;
    this.maxPeers = this.options.maxPeers;
    this.refreshInterval = this.options.refreshInterval;
    this.peerBook = this.options.peerBook;
    this.privateKey = this.options.privateKey;
    this.bootnodes = this.options.bootnodes || [];

    this.chain = chain;
    this.db = db;

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

	      protobuf.load('./messages/wire.proto').then((root) => {
	        this.node.on('peer:connection', (conn, peer) => {
		  this.log.info('peer:connection');

                  // Temporary parameters until the rest is ready.
		  peer.rpc.Hello({
		    networkId: 0,
		    chainId: 0,
                    latestFinalizedRoot: 0x00,
                    latestFinalizedEpoch: 0,
                    bestRoot: 0x00,
                    bestSlot: 0,
		  },

                  (response, peer) => {
                    // Process response  
		  });
		});

                // Simplify this.      
		this.node.handle('Hello', (networkId, chainId, latestFinalizedRoot, latestFinalizedEpoch, bestRoot, BestSlot, peer, response) => {
		  response({
		    // Respond with hello message
		  });    
	       });
	      });

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
}i
