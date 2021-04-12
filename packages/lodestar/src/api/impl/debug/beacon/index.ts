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

  constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "chain" | "db">) {
    this.chain = modules.chain;
    this.db = modules.db;
  }

  async getHeads(): Promise<phase0.SlotRoot[]> {
    return this.chain.forkChoice
      .getHeads()
      .map((blockSummary: IBlockSummary) => ({slot: blockSummary.slot, root: blockSummary.blockRoot}));
  }

  async getState(stateId: StateId): Promise<allForks.BeaconState> {
    return await resolveStateId(this.chain, this.db, stateId);
  }
}
