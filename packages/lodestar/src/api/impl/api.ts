import {IApiOptions} from "../options";
import {IApi, IApiModules} from "./interface";
import {IBeaconApi, BeaconApi} from "./beacon";
import {INodeApi, NodeApi} from "./node";
import {IValidatorApi, ValidatorApi} from "./validator";

export class Api implements IApi {
  public beacon: IBeaconApi;
  public node: INodeApi;
  public validator: IValidatorApi;

  public constructor(opts: Partial<IApiOptions>, modules: IApiModules) {
    this.beacon = new BeaconApi(opts, modules);
    this.node = new NodeApi(opts, modules);
    this.validator = new ValidatorApi(opts, modules);
  }
}
