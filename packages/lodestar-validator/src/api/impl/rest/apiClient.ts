import {RestValidatorApi} from "./validator/validator";
import {RestBeaconApi} from "./beacon/beacon";
import {AbstractApiClient} from "../../abstract";
import {IBeaconApi} from "../../interface/beacon";
import {IValidatorApi} from "../../interface/validators";
import {ILogger} from "../../..";

export class ApiClientOverRest extends AbstractApiClient {
  public beacon: IBeaconApi;

  public validator: IValidatorApi;

  public url: string;
  
  public constructor(restUrl: string, logger: ILogger) {
    super();
    this.url = restUrl;
    this.validator = new RestValidatorApi(restUrl, logger);
    this.beacon = new RestBeaconApi(restUrl, logger);
  }
}