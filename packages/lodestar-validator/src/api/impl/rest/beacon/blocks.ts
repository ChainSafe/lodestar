import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {IBeaconBlocksApi} from "../../../interface/beacon";
import {RestApi} from "./abstract";
import {getSignedBeaconBlockSSZType} from "@chainsafe/lodestar-core";

export class RestBeaconBlocksApi extends RestApi implements IBeaconBlocksApi {
  public async publishBlock(block: SignedBeaconBlock): Promise<void> {
    return this.client.post("/blocks", getSignedBeaconBlockSSZType(this.config, block).toJson(block, {case: "snake"}));
  }
}
