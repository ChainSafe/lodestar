import {RestValidatorApi} from "./validator/validator";
import {RestBeaconApi} from "./beacon/beacon";
import {AbstractApiClient} from "../../abstract";
import {IBeaconApiClient, IEventsApi, INodeApi, IValidatorApi} from "../../types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {RestNodeApi} from "./node/node";
import {RestEventsApi} from "./events/events";

export class ApiClientOverRest extends AbstractApiClient {
  public beacon: IBeaconApiClient;
  public node: INodeApi;
  public events: IEventsApi;
  public validator: IValidatorApi;

  public url: string;

  public constructor(config: IBeaconConfig, restUrl: string, logger: ILogger) {
    super(config, logger);
    this.url = restUrl;
    this.validator = new RestValidatorApi(config, restUrl, logger);
    this.beacon = new RestBeaconApi(config, restUrl, logger);
    this.events = new RestEventsApi(config, restUrl);
    this.node = new RestNodeApi(config, restUrl, logger);
  }
}
