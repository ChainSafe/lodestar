import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {IBeaconBlocksApi} from "../../../interface/beacon";
import {RestApi} from "./abstract";

export class RestBeaconBlocksApi extends RestApi implements IBeaconBlocksApi {
  public async publishBlock(block: SignedBeaconBlock): Promise<void> {
    return this.client.post("/blocks", this.config.types.SignedBeaconBlock.toJson(block, {case: "snake"}));
  }
}
