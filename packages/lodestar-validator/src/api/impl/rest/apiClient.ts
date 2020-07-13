import {RestValidatorApi} from "./validator/validator";
import {RestBeaconApi} from "./beacon/beacon";
import {AbstractApiClient} from "../../abstract";
import {IBeaconApi} from "../../interface/beacon";
import {IValidatorApi} from "../../interface/validators";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {RestNodeApi} from "./node/node";
import {INodeApi} from "../../interface/node";

export class ApiClientOverRest extends AbstractApiClient {
  public beacon: IBeaconApi;
  public node: INodeApi;
  public validator: IValidatorApi;

  public url: string;

  public constructor(config: IBeaconConfig, restUrl: string, logger: ILogger) {
    super(config);
    this.url = restUrl;
    this.validator = new RestValidatorApi(config, restUrl, logger);
    this.beacon = new RestBeaconApi(config, restUrl, logger);
    this.node = new RestNodeApi(config, restUrl, logger);
  }
}
