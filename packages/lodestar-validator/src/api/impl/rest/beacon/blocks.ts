import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {HttpClient} from "../../../../util/httpClient";
import {IBeaconBlocksApi} from "../../../interface/beacon";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {RestApi} from "./abstract";

export class RestBeaconBlocksApi extends RestApi implements IBeaconBlocksApi {
  public constructor(config: IBeaconConfig, client: HttpClient, logger: ILogger) {
    super(config, client, logger);
  }

  public async publishBlock(block: SignedBeaconBlock): Promise<void> {
    return this.client.post("/blocks", this.config.types.SignedBeaconBlock.toJson(block, {case: "snake"}));
  }
}
