import {AbstractApiClient} from "../abstract";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IValidatorApi} from "../interface/validators";
import {IBeaconApi} from "../interface/beacon";

export interface IApiClientOverInstanceOpts {
  config: IBeaconConfig;
  beacon: IBeaconApi;
  validator: IValidatorApi;
}

export class ApiClientOverInstance extends AbstractApiClient {

  public url: string = "inmemory";

  public beacon: IBeaconApi;

  public validator: IValidatorApi;

  public constructor(opts: IApiClientOverInstanceOpts) {
    super();
    this.beacon = opts.beacon;
    this.validator = opts.validator;
    this.config = opts.config;
  }

  public async connect(): Promise<void> {
    await super.connect();
  }

  public async disconnect(): Promise<void> {
    await super.disconnect();
  }

}
