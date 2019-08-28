import {BeaconState} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

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
    const state = await this.get(await this.chain.getLatestStateRoot());
    if(!state) {
      throw new Error("Missing latest state, chain might not be started!");
    }
    return state;
  }

  public async getFinalized(): Promise<BeaconState> {
    const finalized = await this.get(await this.chain.getFinalizedStateRoot());
    if(!finalized) {
      throw new Error("Missing finalized state");
    }
    return finalized;
  }

  public async getJustified(): Promise<BeaconState> {
    const justified = await this.get(await this.chain.getJustifiedStateRoot());
    if(!justified) {
      throw new Error("Missing finalized state");
    }
    return justified;
  }

}
