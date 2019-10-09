import {AbstractApiClient} from "../abstract";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IValidatorApi} from "../api/validators";
import {IBeaconApi} from "../api/beacon";

export interface IRpcClientOverInstanceOpts {
  config: IBeaconConfig;
  beacon: IBeaconApi;
  validator: IValidatorApi;
}

export class RpcClientOverInstance extends AbstractApiClient {

  public url: string = "inmemory";

  public beacon: IBeaconApi;

  public validator: IValidatorApi;

  public constructor(opts: IRpcClientOverInstanceOpts) {
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
