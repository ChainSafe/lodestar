import {AbstractApiClient} from "../abstract";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IValidatorApi} from "../interface/validators";
import {IBeaconApi} from "../interface/beacon";
import {INodeApi} from "../interface/node";

export interface IApiClientOverInstanceOpts {
  config: IBeaconConfig;
  beacon: IBeaconApi;
  node: INodeApi;
  validator: IValidatorApi;
}

export class ApiClientOverInstance extends AbstractApiClient {

  public url = "inmemory";

  public beacon: IBeaconApi;

  public node: INodeApi;

  public validator: IValidatorApi;

  public constructor(opts: IApiClientOverInstanceOpts) {
    super(opts.config);
    this.beacon = opts.beacon;
    this.validator = opts.validator;
    this.node = opts.node;
  }

  public async connect(): Promise<void> {
    await super.connect();
  }

  public async disconnect(): Promise<void> {
    await super.disconnect();
  }

}
