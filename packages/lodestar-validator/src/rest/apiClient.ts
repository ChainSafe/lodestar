import {AbstractApiClient} from "../rpc/abstract";
import {RestValidatorApi} from "./validator/validator";
import {RestBeaconApi} from "./beacon/beacon";
import {IBeaconApi} from "../rpc/api/beacon";
import {IValidatorApi} from "../rpc/api/validators";
import {ILogger} from "../logger/interface";

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