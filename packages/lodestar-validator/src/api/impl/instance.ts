import {AbstractApiClient} from "../abstract";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IValidatorApi} from "../interface/validators";
import {IBeaconApi} from "../interface/beacon";
import {INodeApi} from "../interface/node";
import {WinstonLogger, ILogger} from "@chainsafe/lodestar-utils";
import {IEventsApi} from "../interface/events";
import {IConfigApi} from "../interface/config";

export interface IApiClientOverInstanceOpts {
  config: IBeaconConfig;
  beacon: IBeaconApi;
  node: INodeApi;
  events: IEventsApi;
  validator: IValidatorApi;
  logger?: ILogger;
  configApi: IConfigApi;
}

export class ApiClientOverInstance extends AbstractApiClient {
  url = "inmemory";

  beacon: IBeaconApi;

  node: INodeApi;

  events: IEventsApi;

  validator: IValidatorApi;

  configApi: IConfigApi;

  constructor(opts: IApiClientOverInstanceOpts) {
    super(opts.config, opts.logger || new WinstonLogger());
    this.beacon = opts.beacon;
    this.validator = opts.validator;
    this.events = opts.events;
    this.node = opts.node;
    this.configApi = opts.configApi;
  }

  async connect(): Promise<void> {
    await super.connect();
  }

  async disconnect(): Promise<void> {
    await super.disconnect();
  }
}
