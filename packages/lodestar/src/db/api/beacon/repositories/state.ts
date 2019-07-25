import {DatabaseRepository} from "../repository";
import {BeaconState} from "../../../../types";
import {IBeaconConfig} from "../../../../config";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";
import {ChainRepository} from "./chain";

export class StateRepository extends DatabaseRepository<BeaconState> {

  private chain: ChainRepository;

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController,
    chain: ChainRepository) {
    super(config, db, Bucket.state, config.types.BeaconState);
    this.chain = chain;
  }

  public async getLatest(): Promise<BeaconState | null> {
    return await this.get(await this.chain.getLatestStateRoot());
  }

  public async getFinalized(): Promise<BeaconState> {
    return await this.get(await this.chain.getFinalizedStateRoot());
  }

  public async getJustified(): Promise<BeaconState> {
    return await this.get(await this.chain.getJustifiedStateRoot());
  }

}
