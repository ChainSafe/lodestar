import {BeaconState} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {Repository} from "../repository";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";
import {ChainRepository} from "./chain";

export class StateRepository extends Repository<BeaconState> {

  private chain: ChainRepository;

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController,
    chain: ChainRepository) {
    super(config, db, Bucket.state, config.types.BeaconState);
    this.chain = chain;
  }

  public async getLatest(): Promise<BeaconState> {
    const root = await this.chain.getLatestStateRoot();
    if(!root) {
      throw new Error("Missing latest state root, chain might not be started!");
    }
    const state = await this.get(root);
    if(!state) {
      throw new Error("Missing latest state, chain might not be started!");
    }
    return state;
  }

  public async getFinalized(): Promise<BeaconState> {
    const root = await this.chain.getFinalizedStateRoot();
    if(!root) {
      throw new Error("Missing finalized state  root");
    }
    const finalized = await this.get(root);
    if(!finalized) {
      throw new Error("Missing finalized state");
    }
    return finalized;
  }

  public async getJustified(): Promise<BeaconState> {
    const root = await this.chain.getJustifiedStateRoot();
    if(!root) {
      throw new Error("Missing justified state  root");
    }
    const justified = await this.get(root);
    if(!justified) {
      throw new Error("Missing finalized state");
    }
    return justified;
  }

}
