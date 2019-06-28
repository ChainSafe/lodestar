import {EventEmitter} from "events";
import {INetwork, INetworkOptions} from "../interface";
import {NetworkRpc} from "./rpc";
import {ILogger} from "../../logger";
import {Attestation, BeaconBlock} from "../../types";

export  class HobbitsP2PNetwork extends EventEmitter implements INetwork {
  public peerInfo: PeerInfo;
  private opts: INetworkOptions;
  private rpc: NetworkRpc;
  private inited: Promise<void>;
  private logger: ILogger;

  public constructor(opts: INetworkOptions, {logger}: {logger: ILogger}) {
    super();
    this.opts = opts;
    this.logger = logger;
    // `libp2p` can be a promise as well as a libp2p object
    this.inited = new Promise((resolve) => {
      this.rpc = new NetworkRpc(logger);
      resolve();
    });
  }


  public connect(peerInfo: PeerInfo): Promise<void> {
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

  public start(): Promise<void> {
    return undefined;
  }

  public stop(): Promise<void> {
    return undefined;
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

}