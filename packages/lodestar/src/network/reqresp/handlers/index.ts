import {allForks, phase0} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db";
import {onBeaconBlocksByRange} from "./beaconBlocksByRange";
import {onBeaconBlocksByRoot} from "./beaconBlocksByRoot";

export interface IReqRespHandler {
  onStatus(): AsyncIterable<phase0.Status>;
  onBeaconBlocksByRange(req: phase0.BeaconBlocksByRangeRequest): AsyncIterable<allForks.SignedBeaconBlock>;
  onBeaconBlocksByRoot(req: phase0.BeaconBlocksByRootRequest): AsyncIterable<allForks.SignedBeaconBlock>;
}

/**
 * The ReqRespHandler module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export class ReqRespHandler implements IReqRespHandler {
  private db: IBeaconDb;
  private chain: IBeaconChain;

  constructor({db, chain}: {db: IBeaconDb; chain: IBeaconChain}) {
    this.db = db;
    this.chain = chain;
  }

  async *onStatus(): AsyncIterable<phase0.Status> {
    yield this.chain.getStatus();
  }

  async *onBeaconBlocksByRange(req: phase0.BeaconBlocksByRangeRequest): AsyncIterable<allForks.SignedBeaconBlock> {
    yield* onBeaconBlocksByRange(req, this.chain, this.db);
  }

  async *onBeaconBlocksByRoot(req: phase0.BeaconBlocksByRootRequest): AsyncIterable<allForks.SignedBeaconBlock> {
    yield* onBeaconBlocksByRoot(req, this.chain, this.db);
  }
}
