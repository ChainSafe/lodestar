import {IWireProtocolApi} from "./interface";
import {BeaconChain} from "../../../chain";
import {DB} from "../../../db";

import {
  Request,
  Response,
  Hello,
  Goodbye,
  BeaconBlockRootsRequest,
  BeaconBlockRootsResponse,
  BeaconBlockHeaderRequest,
  BeaconBlockHeaderResponse,
  BeaconBlockBodiesRequest,
  BeaconBlockBodiesResponse,
  BeaconChainStateRequest,
  BeaconChainStateResponse
} from "./messages";

import {
  BlockRootSlot,
  HashTreeRoot
} from "./types";

export class WireProtocolApi implements IWireProtocolApi {

   public namespace: string;

   private chain: BeaconChain;
   private db: DB;

   public constructor(opts, {chain, db}) {
     this.namespace = 'eth2-wire';
     this.db;
     this.chain;
   }

   public async GetStatus(): Promise<GetStatus> {
   
   }

   public async RequestBeaconBlockRoots(request: BeaconBlockRootsRequest): Promise<BeaconBlockRootsResponse> {
   
   }

   public async RequestBeaconBlockHeaders(request: BeaconBlockHeadersRequest): Promise<BeaconBlockHeadersResponse> {
   
   }

   public async RequestBeaconBlockBodies(request: BeaconBlockBodiesRequest): Promise<BeaconBlockBodiesResponse> {
   
   }

   public async RequestBeaconChainState(request: BeaconChainStateRequest): Promise<BeaconChainStateResponse> {
   
   }

}
