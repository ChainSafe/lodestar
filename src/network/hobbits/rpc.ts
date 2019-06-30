/**
 * @module network/libp2p
 */

import {EventEmitter} from "events";
import LibP2p from "libp2p";
import PeerInfo from "peer-info";
import Connection from "interface-connection";
import promisify from "es6-promisify";
import {deserialize} from "@chainsafe/ssz";

import {RequestBody, ResponseBody, WireResponse, WireRequest} from "../../types";
import {Method, RequestId, ResponseCode, RPC_MULTICODEC} from "../../constants";

import {
  encodeRequest,
  encodeResponse,
  sanityCheckData,
  decodeResponseBody,
  decodeRequestBody
} from "../codec";
import {randomRequestId} from "../util";
import {Peer} from "./peer";
import {ILogger} from "../../logger";
import net from "net";


/**
 * The NetworkRpc module controls network-level resources and concerns of p2p connections
 */
export class HobbitsRpc extends EventEmitter {
  private libp2p: LibP2p;
  /**
   * dials in progress
   */
  private wipDials: Set<string>;
  /**
   * Connected peers mapped to peer id
   */
  private peers: Map<string, Peer>;
  /**
   * Milliseconds to request timeout
   */
  private requestTimeout: number;

  /**
   * Active outgoing request ids mapped to methods
   */
  private requests: Record<RequestId, Method>;

  /**
   * Active incoming request ids mapped to peers and methods
   */
  private responses: Record<RequestId, {peer: Peer; method: Method}>;

  private server: net.Server;

  public logger: ILogger;

  public constructor(logger: ILogger) {
    super();
    this.logger = logger;
    this.requestTimeout = 5000;
    this.requests = {};
    this.responses = {};
    this.peers = new Map<string, Peer>();

    this.server = net.createServer();
  }

  public addPeer(peerInfo: PeerInfo): Peer {
    const peerId = peerInfo.id.toB58String();
    let peer = this.peers.get(peerId);
    if (!peer) {
      peer = new Peer(peerInfo, this);
      this.peers.set(peerId, peer);
      // rpc peer connect
      this.emit("peer:connect", peerInfo);
    }
    return peer;
  }
  public removePeer(peerInfo: PeerInfo): void {
    const peerId = peerInfo.id.toB58String();
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.close();
      this.peers.delete(peerId);
      this.emit("peer:disconnect", peerInfo);
    }
  }
  public getPeers(): PeerInfo[] {
    return Array.from(this.peers.values()).map((p) => p.peerInfo);
  }

  public hasPeer(peerInfo: PeerInfo): boolean {
    const peerId = peerInfo.id.toB58String();
    return this.peers.has(peerId);
  }

  public async onConnection(protocol: string, conn: Connection): Promise<void> {
    let peerInfo;
    while (!peerInfo) {
      peerInfo = await promisify(conn.getPeerInfo.bind(conn))();
    }
    const peer = this.addPeer(peerInfo);
    peer.setConnection(conn, true);
  }

  public onConnectionEnd(peerInfo: PeerInfo): void {
    this.removePeer(peerInfo);
  }

  public async dialForRpc(peerInfo: PeerInfo): Promise<void> {
    const peerId = peerInfo.id.toB58String();
    if (this.peers.has(peerId)) {
      return;
    }
    if (this.wipDials.has(peerId)) {
      return;
    }
    this.wipDials.add(peerId);
    try {
      const peer = this.addPeer(peerInfo);
      peer.connect();
    } catch (e) {
      this.logger.error(e.stack);
    }
    this.wipDials.delete(peerId);
  }

  public async sendRequest<T extends ResponseBody>(peerInfo: PeerInfo, method: Method, body: RequestBody): Promise<T> {
    const peerId = peerInfo.id.toB58String();
    const peer = this.peers.get(peerId);
    if (!peer) {
      throw new Error(`Peer does not exist: ${peerId}`);
    }
    const id = randomRequestId();
    this.requests[id] = method;
    const encodedRequest = encodeRequest(id, method, body);
    peer.write(encodedRequest);
    return await this.getResponse(id) as T;
  }

  private async getResponse(id: string): Promise<ResponseBody> {
    return new Promise<ResponseBody>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeAllListeners(id);
        const method = this.requests[id];
        delete this.requests[id];
        reject(new Error(`request timeout, method ${method}, id ${id}`));
      }, this.requestTimeout);
      this.once(`response ${id}`, (err, data) => {
        clearTimeout(timeout);
        delete this.requests[id];
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  }

  public sendResponse(id: RequestId, responseCode: number, result: ResponseBody): void {
    const request = this.responses[id];
    if (!request) {
      throw new Error('No request found');
    }
    const {peer, method} = request;
    const encodedResponse = encodeResponse(id, method, responseCode, result);
    delete this.responses[id];
    peer.write(encodedResponse);
  }

  public onRequestResponse(peer: Peer, data: Buffer): void {
    if(!sanityCheckData(data)) {
      // bad data
      return;
    }
    const id = data.slice(0, 8).toString('hex');
    const method = this.requests[id];
    if (method === undefined) { // incoming request
      try {
        const request: WireRequest = deserialize(data, WireRequest);
        const decodedBody = decodeRequestBody(request.method, request.body);
        this.responses[id] = {peer, method: request.method};
        this.emit("request", peer.peerInfo, request.method, id, decodedBody);
      } catch (e) {
        this.logger.warn('unable to decode request', e.message);
      }
    } else { // incoming response
      try {
        const event = `response ${id}`;
        const {
          responseCode,
          result,
        }: WireResponse = deserialize(data, WireResponse);
        if (responseCode !== ResponseCode.Success) {
          this.emit(event, new Error(`response code error ${responseCode}`), null);
        } else {
          const decodedResult = decodeResponseBody(method, result);
          this.emit(event, null, decodedResult);
        }
      } catch (e) {
        this.logger.warn('unable to decode response', e.message);
      }
    }
  }


  /**
   * Connects to static peers
   */
  private connectStaticPeers = async (): Promise<void> => {
    await Promise.all(this.bootnodes.map((bootnode: string): Promise<void> => {
      return this.connect(bootnode);
    }));
    // console.log(`Connected to ${this.peers.length} static peers`);
  };

  private listenToPeers = (): void => {
    this.peers.map((peer: Peer): void => {

      peer.on(Events.Hello, (data): void => {
        console.log(`Parent Received: ${data}`);
      });

      peer.start();
    })
  };

  public async start(): Promise<void> {
    this.wipDials = new Set();
    this.peers = new Map<string, Peer>();

    this.server.on("connection", (connection): void => {
      const peerOpts: PeerOpts = {ip: connection.remoteAddress, port: connection.remotePort};
      this.peers.push(new Peer(peerOpts));
      console.log(`SERVER :: CONNECTED TO: ${connection.remoteAddress}:${connection.remotePort}`);
      console.log(`SERVER :: TOTAL PEERS: ${this.peers.length}`);
    });

    this.server.on("close", (): void => {
      // console.log("Closing server!");
      this.running = false;
    });

    this.server.listen(this.port, (): void => {
      // console.log("Server started!");
      this.running = true;
    });

    this.connectStaticPeers();
    this.listenToPeers();

    // this.libp2p.handle(RPC_MULTICODEC, this.onConnection.bind(this));
    // this.libp2p.on('peer:connect', this.dialForRpc.bind(this));
    // this.libp2p.on('peer:disconnect', this.removePeer.bind(this));
    // dial any already connected peers
    await Promise.all(
      Object.values(this.libp2p.peerBook.getAll()).map((peer) => this.dialForRpc(peer))
    );
  }

  public async stop(): Promise<void> {
    this.wipDials = new Set();
    this.peers.forEach((peer) => peer.close());
    this.peers = new Map<string, Peer>();

    this.libp2p.unhandle(RPC_MULTICODEC);
    this.libp2p.removeListener('peer:connect', this.dialForRpc.bind(this));
    this.libp2p.removeListener('peer:disconnect', this.removePeer.bind(this));
  }
}
