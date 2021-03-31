import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import {allForks, phase0} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconChain} from "../../../../chain";
import {IBeaconDb} from "../../../../db";
import {IApiOptions} from "../../../options";
import {StateId} from "../../beacon/state";
import {resolveStateId} from "../../beacon/state/utils";
import {IApiModules} from "../../interface";
import {IDebugBeaconApi} from "./interface";

export class DebugBeaconApi implements IDebugBeaconApi {
  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly db: IBeaconDb;
  private readonly logger: ILogger;

  constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "config" | "logger" | "chain" | "db">) {
    this.config = modules.config;
    this.logger = modules.logger;
    this.chain = modules.chain;
    this.db = modules.db;
  }

  async getHeads(): Promise<phase0.SlotRoot[] | null> {
    try {
      return this.chain.forkChoice
        .getHeads()
        .map((blockSummary: IBlockSummary) => ({slot: blockSummary.slot, root: blockSummary.blockRoot}));
    } catch (e) {
      this.logger.error("Failed to get forkchoice heads", e);
      return null;
    }
  }

  async getState(stateId: StateId): Promise<allForks.BeaconState | null> {
    try {
      return await resolveStateId(this.chain, this.db, stateId);
    } catch (e) {
      (e as Error).message;
      this.logger.error("Failed to resolve state", {state: stateId, error: {...(e as Error)}});
      throw e;
    }
  }
}
