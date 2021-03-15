import {IApiOptions} from "../options";
import {IApi, IApiModules} from "./interface";
import {IBeaconApi, BeaconApi} from "./beacon";
import {INodeApi, NodeApi} from "./node";
import {IValidatorApi, ValidatorApi} from "./validator";
import {EventsApi, IEventsApi} from "./events";
import {DebugApi, IDebugApi} from "./debug";
import {ConfigApi, IConfigApi} from "./config";
import {LodestarApi, ILodestarApi} from "./lodestar";

export class Api implements IApi {
  beacon: IBeaconApi;
  node: INodeApi;
  validator: IValidatorApi;
  events: IEventsApi;
  debug: IDebugApi;
  config: IConfigApi;
  lodestar: ILodestarApi;

  constructor(opts: Partial<IApiOptions>, modules: IApiModules) {
    this.beacon = new BeaconApi(opts, modules);
    this.node = new NodeApi(opts, modules);
    this.validator = new ValidatorApi(opts, modules);
    this.events = new EventsApi(opts, modules);
    this.debug = new DebugApi(opts, modules);
    this.config = new ConfigApi(opts, modules);
    this.lodestar = new LodestarApi();
  }
}
