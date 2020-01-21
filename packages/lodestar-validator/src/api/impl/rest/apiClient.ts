import {RestValidatorApi} from "./validator/validator";
import {RestBeaconApi} from "./beacon/beacon";
import {AbstractApiClient} from "../../abstract";
import {IBeaconApi} from "../../interface/beacon";
import {IValidatorApi} from "../../interface/validators";
import {ILogger} from "@chainsafe/eth2.0-utils/lib/logger";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

export class ApiClientOverRest extends AbstractApiClient {
  public beacon: IBeaconApi;

  public validator: IValidatorApi;

  public url: string;
  
  public constructor(config: IBeaconConfig, restUrl: string, logger: ILogger) {
    super();
    this.url = restUrl;
    this.validator = new RestValidatorApi(config, restUrl, logger);
    this.beacon = new RestBeaconApi(restUrl, logger);
  }
}