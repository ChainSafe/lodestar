import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {HttpClient} from "../../../../util/httpClient";
import {IBeaconBlocksApi} from "../../../interface/beacon";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";

export class RestBeaconBlocksApi implements IBeaconBlocksApi {
  private readonly client: HttpClient;
  private readonly logger: ILogger;
  private readonly config: IBeaconConfig;

  public constructor(config: IBeaconConfig, client: HttpClient, logger: ILogger) {
    this.client = client;
    this.logger = logger;
    this.config = config;
  }
  public async publishBlock(block: SignedBeaconBlock): Promise<void> {
    return this.client.post("/blocks", this.config.types.SignedBeaconBlock.toJson(block, {case: "snake"}));
  }
}
