import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, SlotRoot} from "@chainsafe/lodestar-types";
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

  public constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "config" | "logger" | "chain" | "db">) {
    this.config = modules.config;
    this.logger = modules.logger;
    this.chain = modules.chain;
    this.db = modules.db;
  }

  public async getHeads(): Promise<SlotRoot[] | null> {
    try {
      return this.chain.forkChoice
        .getHeads()
        .map((blockSummary) => ({slot: blockSummary.slot, root: blockSummary.blockRoot}));
    } catch (e) {
      this.logger.error("Failed to get forkchoice heads", e);
      return null;
    }
  }

  public async getState(stateId: StateId): Promise<BeaconState | null> {
    try {
      const stateContext = await resolveStateId(this.config, this.db, this.chain.forkChoice, stateId);
      return stateContext?.state || null;
    } catch (e) {
      this.logger.error("Failed to resolve state", {state: stateId, error: e});
      throw e;
    }
  }
}
