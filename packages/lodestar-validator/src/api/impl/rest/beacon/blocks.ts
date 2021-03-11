import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconBlocksApi} from "../../../interface/beacon";
import {RestApi} from "./abstract";

export class RestBeaconBlocksApi extends RestApi implements IBeaconBlocksApi {
  async publishBlock(block: phase0.SignedBeaconBlock): Promise<void> {
    return this.client.post("/blocks", this.config.types.phase0.SignedBeaconBlock.toJson(block, {case: "snake"}));
  }
}
