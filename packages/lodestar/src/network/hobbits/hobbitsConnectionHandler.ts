/**
 * @module network/hobbits
 */

import {EventEmitter} from "events";
import {hashTreeRoot, serialize} from "@chainsafe/ssz";

import {GossipMethod, GossipTopic, Method, ProtocolType, RequestId} from "./constants";

import {decodeRequestBody, encodeRequestBody, sanityCheckData} from "./rpc/codec";
import {hobbitsUriToPeerInfo, randomRequestId, socketConnectionToPeerInfo} from "./util";
import {Peer} from "./peer";
import {ILogger} from "../../logger";
import net from "net";
import {decodeMessage, encodeMessage, generateGossipHeader, generateRPCHeader} from "./codec";
import {INetworkOptions} from "../options";
import {IBeaconConfig} from "../../config";
import {Attestation, BeaconBlock, RequestBody, ResponseBody} from "../../types";
import {promisify} from "util";
import PeerInfo from "peer-info";
import {DecodedMessage, GossipHeader} from "./types";
import {keccak256} from "ethers/utils";

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

  private opts: INetworkOptions;
  private config: IBeaconConfig;

  private server: net.Server;
  public logger: ILogger;
  private peerInfo: PeerInfo;

  public constructor(opts: INetworkOptions, {config, logger}: {config: IBeaconConfig;logger: ILogger}) {
    super();
    this.opts = opts;
    this.config = config;
    this.requestTimeout = opts.rpcTimeout;
    this.logger = logger;
    this.requests = {};
    this.responses = {};
    this.peers = new Map<string, Peer>();
    // Create a server for accepting remote connection
    this.server = net.createServer();
  }

  public getPeerInfo(): PeerInfo {
    return this.peerInfo;
  }

  public addPeer(peerInfo: PeerInfo, emitEvent: boolean): Peer {
    const peerId = peerInfo.id.toB58String();
    let peer = this.peers.get(peerId);
    if (!peer) {
      peer = new Peer(peerInfo, this);
      this.peers.set(peerId, peer);
      // rpc peer connect
      if(emitEvent) {
        // console.log(`Emitting peer connect in ${this.opts.port}`);
        this.emit("peer:connect", peerInfo);
      }
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

  /*public async onConnection(protocol: string, conn: Connection): Promise<void> {
    let peerInfo;
    while (!peerInfo) {
      peerInfo = await promisify(conn.getPeerInfo.bind(conn))();
    }
    const peer = this.addPeer(peerInfo);
    peer.setConnection(conn, true);
  }*/

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
      const peer = this.addPeer(peerInfo, false);
      await peer.connect();
      // emitting event after connection succeeded
      this.emit("peer:connect", peerInfo);
    } catch (e) {
      this.logger.error(`Hobbits :: Fail to dial rpc for peer ${peerId}. Reason: ${e.message}`);
    }
    this.wipDials.delete(peerId);
  }

  public async sendRequest<T extends ResponseBody>(peerInfo: PeerInfo, method: number, body: RequestBody): Promise<T> {
    const peerId = peerInfo.id.toB58String();
    const peer = this.peers.get(peerId);
    if (!peer) {
      throw new Error(`Hobbits :: Peer does not exist: ${peerId}`);
    }
    // encode the request
    const id = randomRequestId();
    // console.log("SendReq: method -"+ id);
    this.requests[id] = method;
    const encodedRequest = encodeRequestBody(this.config, method, body);
    const requestHeader = generateRPCHeader(id, method);
    const encodedMessage = encodeMessage(ProtocolType.RPC, requestHeader, encodedRequest);
    peer.write(encodedMessage);

    return await this.getResponse(id) as T;
  }

  private async getResponse(id: RequestId): Promise<ResponseBody> {
    return new Promise<ResponseBody>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeAllListeners(id.toString());
        const method = this.requests[id];
        delete this.requests[id];
        reject(new Error(`Hobbits :: request timeout, method ${method}, id ${id}`));
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

  public sendResponse(id: RequestId, result: ResponseBody): void {
    const request = this.responses[id];
    if (!request) {
      throw new Error('Hobbits :: No request found');
    }
    const {peer, method} = request;
    const encodedResponse = encodeRequestBody(this.config, method, result);
    const responseHeader = generateRPCHeader(id, method);
    const encodedMessage = encodeMessage(ProtocolType.RPC, responseHeader, encodedResponse);
    delete this.responses[id];
    peer.write(encodedMessage);
  }

  public onRequestResponse(peer: Peer, data: Buffer): void {
    if(!sanityCheckData(data)) {
      // bad data
      this.logger.warn(`Hobbits :: peer ${peer.peerInfo.id.toB58String()} sent wrong data.`);
      return;
    }
    // Changed response
    let decodedBody, requestHeader, requestBody;
    try {
      const decodedMessage: DecodedMessage = decodeMessage(data);
      console.log(decodedMessage);
      // only RPC requests/ responses should be passed here.
      switch (decodedMessage.protocol) {
        case ProtocolType.RPC:
          requestHeader = decodedMessage.requestHeader.rpcHeader;
          requestBody = decodedMessage.requestBody;
          decodedBody = decodeRequestBody(this.config, requestHeader.methodId, requestBody);
          break;
        case ProtocolType.GOSSIP:
          this.processGossipMessage(decodedMessage);

          // return after processing gossip message
          return;

        case ProtocolType.PING:
          break;
      }
    } catch (e) {
      this.logger.warn(`Hobbits :: unable to decode request sent by 
      ${peer.peerInfo.id.toB58String()}: ${e.message}`);
      return;
    }

    const id = requestHeader.id;
    const method = this.requests[id];
    if (method === undefined) { // incoming request
      this.responses[id] = {peer, method: requestHeader.methodId};
      this.emit("request", peer.peerInfo, requestHeader.methodId, id, decodedBody);
    } else { // incoming response
      const event = `response ${id}`;
      this.emit(event, null, decodedBody);
    }
  }

  // process the gossip message
  private processGossipMessage(decodedMessage: DecodedMessage): void {
    const requestHeader: GossipHeader = decodedMessage.requestHeader.gossipHeader;
    // emit event depending on the type
    this.emit(`gossip:${requestHeader.topic}`, decodedMessage);
  }

  public async publishBlock(block: BeaconBlock): Promise<void> {
    // generate gossip message
    const encodedBody = serialize(block, this.config.types.BeaconBlock);
    const messageHash = Buffer.from(keccak256(encodedBody), "hex");
    const hash = hashTreeRoot(block, this.config.types.BeaconBlock);
    const requestHeader = generateGossipHeader(GossipMethod.GOSSIP, GossipTopic.Block, messageHash, hash);
    const encodedMessage = encodeMessage(ProtocolType.GOSSIP, requestHeader, encodedBody);

    // send to all the active peers
    this.peers.forEach(async (peer) => {
      peer.write(encodedMessage);
    });
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    // generate gossip message
    const encodedBody = serialize(attestation, this.config.types.Attestation);
    const messageHash = Buffer.from(keccak256(encodedBody), "hex");
    const hash = hashTreeRoot(attestation, this.config.types.Attestation);
    const requestHeader = generateGossipHeader(GossipMethod.GOSSIP, GossipTopic.Attestation, messageHash, hash);
    const encodedMessage = encodeMessage(ProtocolType.GOSSIP, requestHeader, encodedBody);

    // send to all the active peers
    this.peers.forEach(async (peer) => {
      peer.write(encodedMessage);
    });
  }

  public async publishShardAttestation(attestation: Attestation): Promise<void> {
    // await promisify(this.pubsub.publish.bind(this.pubsub))(
    //     shardSubnetAttestationTopic(attestation.data.shard), serialize(attestation, Attestation));
  }

  /**
   * Connects to static peers
   */
  private async connectStaticPeers(): Promise<void> {
    await Promise.all(this.opts.bootnodes.map(async (bootnode: string): Promise<void> => {
      const peerInfo = await hobbitsUriToPeerInfo(bootnode);
      if (peerInfo) {
        return this.dialForRpc(peerInfo);
      }
    }));
  };

  public async start(): Promise<void> {
    this.wipDials = new Set();
    this.peers = new Map<string, Peer>();

    this.server.on("connection", async (connection): Promise<void> => {
      const peerInfo = await socketConnectionToPeerInfo(connection);
      const peer = this.addPeer(peerInfo, true);
      // save the connection
      peer.setConnection(connection);
      this.logger.info(`Hobbits :: connected to peer: ${peerInfo.id.toB58String()}.`);
    });

    this.server.on("close", (): void => {
      this.logger.info(`Hobbits :: server closed on port: ${this.opts.port}.`);
    });

    this.server.listen(this.opts.port, '0.0.0.0', (): void => {
      this.logger.info(`Hobbits :: server started on port: ${this.opts.port}.`);
    });

    await this.connectStaticPeers();

    // initialize the peerInfo
    const addr = `/ip4/127.0.0.1/tcp/${this.opts.port}`;
    this.peerInfo = await promisify(PeerInfo.create.bind(this))();
    this.peerInfo.multiaddrs.add(addr);

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
    this.peers.forEach(async (peer) => {
      // console.log(`Trying to close from port: ${this.opts.port}`);
      await peer.close();
    });
    // this.peers.forEach(async (peer) => await promisify(peer.close.bind(peer)()));
    this.peers = new Map<string, Peer>();
    await promisify(this.server.close.bind(this.server))();

    // this.libp2p.unhandle(RPC_MULTICODEC);
    // this.libp2p.removeListener('peer:connect', this.dialForRpc.bind(this));
    // this.libp2p.removeListener('peer:disconnect', this.removePeer.bind(this));
  }
}
