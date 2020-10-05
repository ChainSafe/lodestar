import {AbstractApiClient} from "../abstract";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconApiClient, IEventsApi, INodeApi, IValidatorApi} from "../types";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils";

export interface IApiClientOverInstanceOpts {
  config: IBeaconConfig;
  beacon: IBeaconApiClient;
  node: INodeApi;
  events: IEventsApi;
  validator: IValidatorApi;
  logger?: ILogger;
}

export class ApiClientOverInstance extends AbstractApiClient {
  public url = "inmemory";

  public beacon: IBeaconApiClient;

  public node: INodeApi;

  public events: IEventsApi;

  public validator: IValidatorApi;

  public constructor(opts: IApiClientOverInstanceOpts) {
    super(opts.config, opts.logger || new WinstonLogger());
    this.beacon = opts.beacon;
    this.validator = opts.validator;
    this.events = opts.events;
    this.node = opts.node;
  }

  public async connect(): Promise<void> {
    await super.connect();
  }

  public async disconnect(): Promise<void> {
    await super.disconnect();
  }
}
