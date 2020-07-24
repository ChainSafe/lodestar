import {IBeaconStateApi, StateId} from "./interface";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IApiOptions} from "../../../options";
import {IApiModules} from "../../../interface";
import {BeaconState} from "@chainsafe/lodestar-types";
import {resolveStateId} from "./utils";
import {IBeaconDb} from "../../../../db/api";
import {ILMDGHOST} from "../../../../chain/forkChoice";

export class BeaconStateApi implements IBeaconStateApi {
  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;
  private readonly forkChoice: ILMDGHOST;

  public constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "config"|"db"|"chain">) {
    this.config = modules.config;
    this.db = modules.db;
    this.forkChoice = modules.chain.forkChoice;
  }

  public async getState(stateId: StateId): Promise<BeaconState> {
    return resolveStateId(this.config, this.db, this.forkChoice, stateId);
  }

}
