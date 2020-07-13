import {SyncingStatus} from "@chainsafe/lodestar-types";
import {INodeApi} from "../../../src/api/interface/node";

export class MockNodeApi implements INodeApi {

  public async getVersion(): Promise<string> {
    return "dev";
  }


  public async getSyncingStatus(): Promise<SyncingStatus> {
    return {
      headSlot: BigInt(0),
      syncDistance: BigInt(0)
    };
  }
}
