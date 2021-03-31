import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconParams} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {IApiModules} from "..";
import {IApiOptions} from "../../options";
import {IConfigApi} from "./interface";

export class ConfigApi implements IConfigApi {
  private readonly config: IBeaconConfig;

  constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "config">) {
    this.config = modules.config;
  }

  async getForkSchedule(): Promise<phase0.Fork[]> {
    // @TODO: implement the actual fork schedule data get from config params once marin's altair PRs have been merged
    return [];
  }

  async getDepositContract(): Promise<phase0.Contract> {
    return {
      chainId: this.config.params.DEPOSIT_CHAIN_ID,
      address: this.config.params.DEPOSIT_CONTRACT_ADDRESS,
    };
  }

  async getSpec(): Promise<IBeaconParams> {
    return this.config.params;
  }
}
