import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db";
import {ITaskService} from "../../../tasks/interface";
import {onBeaconBlocksByRange} from "./beaconBlocksByRange";
import {onBeaconBlocksByRoot} from "./beaconBlocksByRoot";

export interface IReqRespHandler {
  onStatus(): AsyncIterable<phase0.Status>;
  onBeaconBlocksByRange(req: phase0.RequestBody): AsyncIterable<phase0.SignedBeaconBlock>;
  onBeaconBlocksByRoot(req: phase0.RequestBody): AsyncIterable<phase0.SignedBeaconBlock>;
  registerChores(chores: ITaskService): void;
}

/**
 * The ReqRespHandler module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export class ReqRespHandler implements IReqRespHandler {
  private config: IBeaconConfig;
  private db: IBeaconDb;
  private chain: IBeaconChain;
  private chores: ITaskService | undefined;

  constructor({config, db, chain}: {config: IBeaconConfig; db: IBeaconDb; chain: IBeaconChain}) {
    this.config = config;
    this.db = db;
    this.chain = chain;
  }

  async *onStatus(): AsyncIterable<phase0.Status> {
    yield this.chain.getStatus();
  }

  async *onBeaconBlocksByRange(req: phase0.BeaconBlocksByRangeRequest): AsyncIterable<phase0.SignedBeaconBlock> {
    yield* await onBeaconBlocksByRange(this.config, req, this.chain, this.db, this.chores);
  }

  async *onBeaconBlocksByRoot(req: phase0.BeaconBlocksByRootRequest): AsyncIterable<phase0.SignedBeaconBlock> {
    yield* onBeaconBlocksByRoot(req, this.db);
  }

  registerChores(chores: ITaskService): void {
    this.chores = chores;
  }
}
