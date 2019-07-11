/**
 * @module network/hobbits
 */

import {EventEmitter} from "events";
import {deserialize} from "@chainsafe/ssz";

import {RequestBody, ResponseBody, WireRequest, WireResponse} from "./rpc/messages";
import {RPC_MULTICODEC} from "../../constants";
import {HOBBITS_DEFAULT_PORT, Method, ProtocolType, RequestId, ResponseCode} from "./constants";

import {decodeRequestBody, encodeRequest, sanityCheckData} from "./rpc/codec";
import {randomRequestId} from "./util";
import {Peer} from "./peer";
import {ILogger} from "../../logger";
import net from "net";
import {HobbitsUri} from "./hobbitsUri";
import {decodeMessage, encodeMessage} from "./codec";


/**
 * The NetworkRpc module controls network-level resources and concerns of p2p connections
 */
export class HobbitsConnectionHandler extends EventEmitter {
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
  private bootnodes: string[];

  public constructor(bootnodes: string[], logger: ILogger) {
    super();
    this.bootnodes = bootnodes;
    this.logger = logger;
    this.requestTimeout = 5000;
    this.requests = {};
    this.responses = {};
    this.peers = new Map<string, Peer>();
    // Create a server for accepting remote connection
    this.server = net.createServer();
  }

  public addPeer(hobbitsUri: HobbitsUri): Peer {
    let peerId = hobbitsUri.toUri();
    let peer = this.peers.get(peerId);
    if (!peer) {
      peer = new Peer(hobbitsUri, this);
      this.peers.set(peerId, peer);
      // rpc peer connect
      this.emit("peer:connect", hobbitsUri);
    }
    return peer;
  }
  public removePeer(hobbitsUri: HobbitsUri): void {
    let peerId = hobbitsUri.toUri();
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.close();
      this.peers.delete(peerId);
      this.emit("peer:disconnect", hobbitsUri);
    }
  }
  public getPeers(): HobbitsUri[] {
    return Array.from(this.peers.values()).map((p) => p.hobbitsUri);
  }

  public hasPeer(hobbitsUri: HobbitsUri): boolean {
    const peerId = hobbitsUri.toUri();
    return this.peers.has(peerId);
  }

  /*public async onConnection(protocol: string, conn: Connection): Promise<void> {
    let peerInfo;
    while (!peerInfo) {
      peerInfo = await promisify(conn.getPeerInfo.bind(conn))();
    }
    const peer = this.addPeer(peerInfo);
    peer.setConnection(conn, true);
  }*/

  public onConnectionEnd(hobbitsUri: HobbitsUri): void {
    this.removePeer(hobbitsUri);
  }

  public async dialForRpc(hobbitsUri: HobbitsUri): Promise<void> {
    const peerId = hobbitsUri.toUri();
    if (this.peers.has(peerId)) {
      return;
    }
    if (this.wipDials.has(peerId)) {
      return;
    }
    this.wipDials.add(peerId);
    try {
      const peer = this.addPeer(hobbitsUri);
      peer.connect();
    } catch (e) {
      this.logger.error(e.stack);
    }
    this.wipDials.delete(peerId);
  }

  public async sendRequest<T extends ResponseBody>(hobbitsUri: HobbitsUri, type: ProtocolType, method: Method, body: RequestBody): Promise<T> {
    const peerId = hobbitsUri.toUri();
    const peer = this.peers.get(peerId);
    if (!peer) {
      throw new Error(`Peer does not exist: ${peerId}`);
    }
    let encodedRequest;
    const id = randomRequestId();
    if (type == ProtocolType.RPC) {
      this.requests[id] = method;
      encodedRequest = encodeRequest(id, method, body);
    }

    const encodedMessage = encodeMessage(type, encodedRequest);
    peer.write(encodedMessage);
    return await this.getResponse(id) as T;
  }

  private async getResponse(id: RequestId): Promise<ResponseBody> {
    return new Promise<ResponseBody>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeAllListeners(id.toString());
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

  // public sendResponse(id: RequestId, responseCode: number, result: ResponseBody): void {
  //   const request = this.responses[id];
  //   if (!request) {
  //     throw new Error('No request found');
  //   }
  //   const {peer, method} = request;
  //   const encodedResponse = encodeResponse(id, method, responseCode, result);
  //   delete this.responses[id];
  //   peer.write(encodedResponse);
  // }

  public onRequestResponse(peer: Peer, data: Buffer): void {
    if(!sanityCheckData(data)) {
      // bad data
      return;
    }
    // Changed response
    let decodedBody, request;
    try {
      let decodedMessage = decodeMessage(data);
      switch (decodedMessage.protocol) {
        case ProtocolType.RPC:
          request = deserialize(decodedMessage.payload, WireRequest);
          decodedBody = decodeRequestBody(request.methodId, request.body);
          break;
        case ProtocolType.GOSSIP:
          break;
        case ProtocolType.PING:
          break;
      }
    } catch (e) {
      this.logger.warn('unable to decode request', e.message);
      return;
    }

    const id = request.id;
    const method = this.requests[id];
    if (method === undefined) { // incoming request
      this.responses[id] = {peer, method: request.method};
      this.emit("request", peer.hobbitsUri, request.method, id, decodedBody);
    } else { // incoming response
      const event = `response ${id}`;
      this.emit(event, null, decodedBody);
    }
  }

  /**
   * Connects to static peers
   */
  private connectStaticPeers = async (): Promise<void> => {
    await Promise.all(this.bootnodes.map((bootnode: string): Promise<void> => {
      return this.dialForRpc(new HobbitsUri({uriString: bootnode}));
    }));
  };

  public async start(): Promise<void> {
    this.wipDials = new Set();
    this.peers = new Map<string, Peer>();

    this.server.on("connection", (connection): void => {
      let hobbitsUri = new HobbitsUri({
        host: connection.remoteAddress,
        port: connection.remotePort,
        scheme: "tcp",
      });
      this.addPeer(hobbitsUri);
      this.logger.info(`SERVER :: CONNECTED TO: ${hobbitsUri}`);
    });

    this.server.on("close", (): void => {
      this.logger.info("Closing hobbits server!");
      // this.running = false;
    });

    this.server.listen(HOBBITS_DEFAULT_PORT, (): void => {
      this.logger.info("Hobbits server started!");
      // this.running = true;
    });

    this.connectStaticPeers();

    // this.libp2p.handle(RPC_MULTICODEC, this.onConnection.bind(this));
    // this.libp2p.on('peer:connect', this.dialForRpc.bind(this));
    // this.libp2p.on('peer:disconnect', this.removePeer.bind(this));
    // dial any already connected peers
    // await Promise.all(
    //   Object.values(this.libp2p.peerBook.getAll()).map((peer) => this.dialForRpc(peer))
    // );
  }

  public async stop(): Promise<void> {
    this.wipDials = new Set();
    this.peers.forEach((peer) => peer.close());
    this.peers = new Map<string, Peer>();
    this.server.close();

    // this.libp2p.unhandle(RPC_MULTICODEC);
    // this.libp2p.removeListener('peer:connect', this.dialForRpc.bind(this));
    // this.libp2p.removeListener('peer:disconnect', this.removePeer.bind(this));
  }
}
