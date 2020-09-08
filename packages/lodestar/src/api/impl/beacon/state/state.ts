import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState} from "@chainsafe/lodestar-types";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {IBeaconDb} from "../../../../db/api";
import {IApiOptions} from "../../../options";
import {IApiModules} from "../../interface";
import {IBeaconStateApi, StateId} from "./interface";
import {resolveStateId} from "./utils";

export class BeaconStateApi implements IBeaconStateApi {
  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;
  private readonly forkChoice: ForkChoice;

  public constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "config" | "db" | "chain">) {
    this.config = modules.config;
    this.db = modules.db;
    this.forkChoice = modules.chain.forkChoice;
  }

  public async getState(stateId: StateId): Promise<BeaconState | null> {
    return resolveStateId(this.config, this.db, this.forkChoice, stateId);
  }
}
