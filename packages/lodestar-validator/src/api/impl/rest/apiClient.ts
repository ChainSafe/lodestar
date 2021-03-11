import {RestValidatorApi} from "./validator/validator";
import {RestBeaconApi} from "./beacon/beacon";
import {AbstractApiClient} from "../../abstract";
import {IBeaconApi} from "../../interface/beacon";
import {IValidatorApi} from "../../interface/validators";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {RestNodeApi} from "./node/node";
import {INodeApi} from "../../interface/node";
import {RestEventsApi} from "./events/events";
import {IEventsApi} from "../../interface/events";
import {RestConfigApi} from "./config/config";
import {IConfigApi} from "../../interface/config";

export class ApiClientOverRest extends AbstractApiClient {
  beacon: IBeaconApi;
  node: INodeApi;
  events: IEventsApi;
  validator: IValidatorApi;
  configApi: IConfigApi;

  url: string;

  constructor(config: IBeaconConfig, restUrl: string, logger: ILogger) {
    super(config, logger);
    this.url = restUrl;
    this.validator = new RestValidatorApi(config, restUrl, logger);
    this.beacon = new RestBeaconApi(config, restUrl, logger);
    this.events = new RestEventsApi(config, restUrl);
    this.node = new RestNodeApi(config, restUrl, logger);
    this.configApi = new RestConfigApi(config, restUrl, logger);
  }
}
