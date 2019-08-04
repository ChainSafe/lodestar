/**
 * @module network/libp2p
 */

import {EventEmitter} from "events";
import LibP2p from "libp2p";
import PeerInfo from "peer-info";
import Connection from "interface-connection";
import promisify from "es6-promisify";
import {deserialize} from "@chainsafe/ssz";
import {RequestBody, ResponseBody, WireResponse, WireRequest} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {Method, RequestId, ResponseCode, RPC_MULTICODEC} from "../../constants";
import {ILogger} from "../../logger";
import {
  encodeRequest,
  encodeResponse,
  sanityCheckData,
  decodeResponseBody,
  decodeRequestBody
} from "../codec";
import {randomRequestId} from "../util";
import {Peer} from "./peer";
import {INetworkOptions} from "../options";
import StrictEventEmitter from "strict-event-emitter-types";

interface INetworkRpcEvents {
  ["peer:connect"]: (peerInfo: PeerInfo) => void;
  ["peer:disconnect"]: (peerInfo: PeerInfo) => void;
  request: (peerInfo: PeerInfo, method: Method, id: RequestId, body: RequestBody) => void;
  // we cannot typehint dynamic keys
  //[response ${id}]: (err: Error|null, data: ResponseBody) => void
}

export type NetworkRpcEventEmitter = StrictEventEmitter<EventEmitter, INetworkRpcEvents>;

/**
 * The NetworkRpc module controls network-level resources and concerns of p2p connections
 */
export class NetworkRpc extends (EventEmitter as { new(): NetworkRpcEventEmitter }) implements NetworkRpcEventEmitter{
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

  private config: IBeaconConfig;
  private logger: ILogger;

  public constructor(opts: INetworkOptions, {config, libp2p, logger}: {config: IBeaconConfig; libp2p: LibP2p; logger: ILogger}) {
    super();
    this.config = config;
    this.logger = logger;
    this.libp2p = libp2p;
    this.requestTimeout = 5000;
    this.requests = {};
    this.responses = {};
    this.peers = new Map<string, Peer>();
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
    if (!this.libp2p.isStarted()) {
      return;
    }
    const peerId = peerInfo.id.toB58String();
    if (this.peers.has(peerId)) {
      return;
    }
    if (this.wipDials.has(peerId)) {
      return;
    }
    this.wipDials.add(peerId);
    try {
      const conn = await promisify(this.libp2p.dialProtocol.bind(this.libp2p))(peerInfo, RPC_MULTICODEC);
      const peer = this.addPeer(peerInfo);
      peer.setConnection(conn, false);
    } catch (e) {
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
    const encodedRequest = encodeRequest(this.config, id, method, body);
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
      // @ts-ignore
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
    const encodedResponse = encodeResponse(this.config, id, method, responseCode, result);
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
        const request: WireRequest = deserialize(data, this.config.types.WireRequest);
        const decodedBody = decodeRequestBody(this.config, request.method, request.body);
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
        }: WireResponse = deserialize(data, this.config.types.WireResponse);
        if (responseCode !== ResponseCode.Success) {
          // @ts-ignore
          this.emit(event, new Error(`response code error ${responseCode}`), null);
        } else {
          const decodedResult = decodeResponseBody(this.config, method, result);
          // @ts-ignore
          this.emit(event, null, decodedResult);
        }
      } catch (e) {
        this.logger.warn('unable to decode response', e.message);
      }
    }
  }

  public async start(): Promise<void> {
    this.wipDials = new Set();
    this.peers = new Map<string, Peer>();

    this.libp2p.handle(RPC_MULTICODEC, this.onConnection.bind(this));
    this.libp2p.on('peer:connect', this.dialForRpc.bind(this));
    this.libp2p.on('peer:disconnect', this.removePeer.bind(this));
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
