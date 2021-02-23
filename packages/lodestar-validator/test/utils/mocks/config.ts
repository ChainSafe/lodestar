import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconParams} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {IConfigApi} from "../../../src/api/interface/config";

export interface IMockConfigApiOpts {
  config: IBeaconConfig;
}

export class MockConfigApi implements IConfigApi {
  private readonly config: IBeaconConfig;

  constructor(opts: IMockConfigApiOpts) {
    this.config = opts.config;
  }

  public async getForkSchedule(): Promise<phase0.Fork[]> {
    return [];
  }

  public async getDepositContract(): Promise<phase0.Contract> {
    return {
      chainId: this.config.params.DEPOSIT_CHAIN_ID,
      address: this.config.params.DEPOSIT_CONTRACT_ADDRESS,
    };
  }

  public async getSpec(): Promise<IBeaconParams> {
    return this.config.params;
  }
}
