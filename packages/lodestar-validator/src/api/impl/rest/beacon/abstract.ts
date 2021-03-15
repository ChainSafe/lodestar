import {HttpClient} from "../../../../util";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

export abstract class RestApi {
  protected readonly client: HttpClient;
  protected readonly logger: ILogger;
  protected readonly config: IBeaconConfig;

  constructor(config: IBeaconConfig, client: HttpClient, logger: ILogger) {
    this.client = client;
    this.logger = logger;
    this.config = config;
  }
}
