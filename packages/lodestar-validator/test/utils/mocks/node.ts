import {phase0} from "@chainsafe/lodestar-types";
import {INodeApi} from "../../../src/api/interface/node";

export class MockNodeApi implements INodeApi {
  async getVersion(): Promise<string> {
    return "dev";
  }

  async getSyncingStatus(): Promise<phase0.SyncingStatus> {
    return {
      headSlot: BigInt(0),
      syncDistance: BigInt(0),
    };
  }
}
