import {IApiOptions} from "../options";
import {IApi, IApiModules} from "./interface";
import {IBeaconApi, BeaconApi} from "./beacon";
import {INodeApi, NodeApi} from "./node";
import {IValidatorApi, ValidatorApi} from "./validator";
import {EventsApi, IEventsApi} from "./events";
import {IDebugApi} from "./debug/interface";
import {DebugApi} from "./debug";

export class Api implements IApi {
  public beacon: IBeaconApi;
  public node: INodeApi;
  public validator: IValidatorApi;
  public events: IEventsApi;
  public debug: IDebugApi;

  public constructor(opts: Partial<IApiOptions>, modules: IApiModules) {
    this.beacon = new BeaconApi(opts, modules);
    this.node = new NodeApi(opts, modules);
    this.validator = new ValidatorApi(opts, modules);
    this.events = new EventsApi(opts, modules);
    this.debug = new DebugApi(opts, modules);
  }
}
