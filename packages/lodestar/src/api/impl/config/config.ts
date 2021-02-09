import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Fork, Contract} from "@chainsafe/lodestar-types";
import {IApiModules} from "..";
import {IApiOptions} from "../../options";
import {IConfigApi} from "./interface";

export class ConfigApi implements IConfigApi {
  private readonly config: IBeaconConfig;

  public constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "config">) {
    this.config = modules.config;
  }

  public getForkSchedule(): Fork[] {
    // @TODO: implement the actual fork schedule data get from config params once marin's lightclient PRs have been merged
    return [];
  }

  public getDepositContract(): Contract {
    return {
      chainId: this.config.params.DEPOSIT_CHAIN_ID,
      address: this.config.params.DEPOSIT_CONTRACT_ADDRESS,
    };
  }
}
