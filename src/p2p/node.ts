import LibP2p from "libp2p";
import {TCP} from "libp2p-tcp";
import {Mplex} from "libp2p-mplex";
import {Bootstrap} from "libp2p-bootstrap";
import {promisify} from "es6-promisify";
import {PeerInfo} from "peer-info";
import {PeerId} from "peer-id";
import {defaultsDeep} from "@nodeutils/defaults-deep";
import * as FloodSub from "libp2p-floodsub";
import {protobuf} from "protobufjs";
import logger, {AbstractLogger} from "../logger";
import {PeerBook} from "peer-book";

export interface LodestarNodeOpts {
  bootstrap?: string[];
  peerInfo: PeerInfo;
  bootnodes?: string[];
}

export class LodestarNode extends LibP2p {

  private pubsub: FloodSub;

  private log: AbstractLogger;

  private peerBook: PeerBook;

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

    this.handlers = {};
    this.requests = {};
    this.peerBook = new PeerBook();
    this.log = logger;
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
    const startFn = promisify(super.start.bind(this));
    await startFn((err) => {
      if (err) {
	this.log.info(err);
        return;
      }

      this.on('peer:discovery', (peerInfo) => {
        this.log.info(`Discovered Peer: ${peerInfo}`);
	const peerId = peerInfo.id.toB58String();
	if (peerBook.has(peerId)) {
	  return;
	}

	this.peerBook.put(peerInfo);

	this.dialProtocol(peerInfo, 'eth/serenity/beacon/rpc/1', (err, conn) => {
	  if (err) {
	    this.log.info(`Error during dialing: ${err} `);
            return; 
	  }

	  return this._connection(conn, peerInfo);
	})
      });
      super.handle('eth/serenity/beacon/rpc/1', (protocol, conn) => {
        return this._connection(conn, null);
      });
 
      this.on('peer:connect', (peerInfo) => {
        this.log.info(`Peer connected: ${peerInfo}`);
	this.peerBook.put(peerInfo);
      });

      this.on('peer:disconnect', (peerInfo) => {
        this.log.info(`Peer disconnected: ${peerInfo}`);
	this.peerBook.remote(peerInfo);
      });
      
    });
    await promisify(this.pubsub.start.bind(this.pubsub))();
  }

  public async handle() {
  
  }

  private async _connection(conn: Connection, peer:): Promise<void> {
  
  }

  private async _rpc(send: ): Promise<void> {
  
  }
}

