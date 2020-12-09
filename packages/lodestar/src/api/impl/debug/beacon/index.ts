import {SlotRoot} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconChain} from "../../../../chain";
import {IApiOptions} from "../../../options";
import {IApiModules} from "../../interface";
import {IDebugBeaconApi} from "./interface";

export class DebugBeaconApi implements IDebugBeaconApi {
  private readonly chain: IBeaconChain;
  private readonly logger: ILogger;

  public constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "logger" | "chain">) {
    this.logger = modules.logger;
    this.chain = modules.chain;
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
}
