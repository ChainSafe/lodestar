import {AbstractApiClient} from "../abstract";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IValidatorApi} from "../interface/validators";
import {IBeaconApi} from "../interface/beacon";

export interface IApiClientOverInstanceOpts {
  config: IBeaconConfig;
  beacon: IBeaconApi;
  validator: IValidatorApi;
}

export class ApiClientOverInstance extends AbstractApiClient {

  public url = "inmemory";

  public beacon: IBeaconApi;

  public validator: IValidatorApi;

  public constructor(opts: IApiClientOverInstanceOpts) {
    super(opts.config);
    this.beacon = opts.beacon;
    this.validator = opts.validator;
  }

  public async connect(): Promise<void> {
    await super.connect();
  }

  public async disconnect(): Promise<void> {
    await super.disconnect();
  }

}
