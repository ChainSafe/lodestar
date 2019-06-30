import {EventEmitter} from "events";
import {INetwork, INetworkOptions} from "../interface";
import {HobbitsRpc} from "./rpc";
import {ILogger} from "../../logger";
import {Attestation, BeaconBlock} from "../../types";
import net from "net";
import PeerInfo from "peer-info";
import NodeAddress = Multiaddr.NodeAddress;
import {peerInfoToAddress} from "./util";

export  class HobbitsP2PNetwork extends EventEmitter implements INetwork {
  public peerInfo: PeerInfo;
  private opts: INetworkOptions;
  private rpc: HobbitsRpc;
  private inited: Promise<void>;
  private logger: ILogger;
  private port: number;
  private bootnodes: string[];
  public running: boolean;


  public constructor(opts: INetworkOptions, {logger}: {logger: ILogger}) {
    super();
    this.port = 9000;
    this.bootnodes = opts.bootnodes || [];
    this.running = false;

    this.opts = opts;
    this.logger = logger;
    // `libp2p` can be a promise as well as a libp2p object
    this.inited = new Promise((resolve) => {
      this.rpc = new HobbitsRpc(logger);
      resolve();
    });
  }


  public connect(peerInfo: PeerInfo): Promise<void> {
    let nodeAddr = peerInfoToAddress(peerInfo);

    return undefined;
  }

  public disconnect(peerInfo: PeerInfo): void {
  }

  public getPeers(): PeerInfo[] {
    return [];
  }

  public hasPeer(peerInfo: PeerInfo): boolean {
    return false;
  }

  public publishAttestation(attestation: Attestation): Promise<void> {
    return undefined;
  }

  public publishBlock(block: BeaconBlock): Promise<void> {
    return undefined;
  }

  public publishShardAttestation(attestation: Attestation): Promise<void> {
    return undefined;
  }

  public sendRequest<T extends ResponseBody>(peerInfo: PeerInfo, method: Method, body: Hello | Goodbye | Status | BeaconBlockRootsRequest | BeaconBlockHeadersRequest | BeaconBlockBodiesRequest | BeaconStatesRequest): Promise<T> {
    return undefined;
  }

  public sendResponse(id: string, responseCode: number, result: Hello | Goodbye | Status | BeaconBlockRootsResponse | BeaconBlockHeadersResponse | BeaconBlockBodiesResponse | BeaconStatesResponse): void {
  }

  public subscribeToAttestations(): void {
  }

  public subscribeToBlocks(): void {
  }

  public subscribeToShardAttestations(shard: number): void {
  }

  public unsubscribeToAttestations(): void {
  }

  public unsubscribeToBlocks(): void {
  }

  public unsubscribeToShardAttestations(shard: number): void {
  }

  public start(): Promise<void> {

  }

  public stop(): Promise<void> {
    return undefined;
  }

}