import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import {allForks, phase0} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "../../../../chain";
import {IBeaconDb} from "../../../../db";
import {IApiOptions} from "../../../options";
import {StateId} from "../../beacon/state";
import {resolveStateId} from "../../beacon/state/utils";
import {IApiModules} from "../../interface";
import {IDebugBeaconApi} from "./interface";

export class DebugBeaconApi implements IDebugBeaconApi {
  private readonly chain: IBeaconChain;
  private readonly db: IBeaconDb;
  private readonly config: IBeaconConfig;

  constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "chain" | "db" | "config">) {
    this.chain = modules.chain;
    this.db = modules.db;
    this.config = modules.config;
  }

  async getHeads(): Promise<phase0.SlotRoot[]> {
    return this.chain.forkChoice
      .getHeads()
      .map((blockSummary: IBlockSummary) => ({slot: blockSummary.slot, root: blockSummary.blockRoot}));
  }

  async getState(stateId: StateId): Promise<allForks.BeaconState> {
    return await resolveStateId(this.config, this.chain, this.db, stateId, {processNearestState: true});
  }
}
