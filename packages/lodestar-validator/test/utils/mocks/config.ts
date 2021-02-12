import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconParams} from "@chainsafe/lodestar-params";
import {Contract, Fork} from "@chainsafe/lodestar-types";
import {fromHex} from "@chainsafe/lodestar-utils";
import {IConfigApi} from "../../../src/api/interface/config";

export interface IMockConfigApiOpts {
  config: IBeaconConfig;
}

export class MockConfigApi implements IConfigApi {
  private readonly config: IBeaconConfig;

  constructor(opts: IMockConfigApiOpts) {
    this.config = opts.config;
  }

  public async getForkSchedule(): Promise<Fork[]> {
    return [];
  }

  public async getDepositContract(): Promise<Contract> {
    return {
      chainId: 0,
      address: fromHex("0x1234567890123456789012345678901234567890"),
    } as Contract;
  }

  public async getSpec(): Promise<IBeaconParams> {
    return this.config.params;
  }
}
