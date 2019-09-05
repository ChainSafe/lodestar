import { AbstractRpcClient } from "../rpc/abstract";
import { IBeaconApi, IValidatorApi } from "../../api/rpc";
import { RestValidatorApi } from "./validator/validator";
import { RestBeaconApi } from "./beacon/beacon";
import { ILogger } from "../../logger";

export class ApiClientOverRest extends AbstractRpcClient {
  public beacon: IBeaconApi;

  public validator: IValidatorApi;
  
  public constructor(restUrl: string, logger: ILogger) {
    super();
    this.validator = new RestValidatorApi(restUrl, logger);
    this.beacon = new RestBeaconApi(restUrl, logger);
  }
}