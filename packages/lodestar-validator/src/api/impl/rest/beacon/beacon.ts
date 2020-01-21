import {bytes32, Fork, SyncingStatus, BeaconBlock, BeaconState, number64, uint64} from "@chainsafe/eth2.0-types";
import {IBeaconApi} from "../../../interface/beacon";
import {HttpClient} from "../../../../util";
import {ILogger} from "@chainsafe/eth2.0-utils/lib/logger";

export class RestBeaconApi implements IBeaconApi {

  private client: HttpClient;

  public constructor(restUrl: string, logger: ILogger) {
    this.client = new HttpClient({urlPrefix: `${restUrl}/node`}, {logger});
  }

  public async getClientVersion(): Promise<bytes32> {
    return this.client.get<bytes32>("/version");
  }

  public async getFork(): Promise<{fork: Fork; chainId: uint64}> {
    return this.client.get<{fork: Fork; chainId: uint64}>("/fork");
  }

  public async getGenesisTime(): Promise<number64> {
    return this.client.get<number64>("/genesis_time");
  }

  public async getSyncingStatus(): Promise<boolean | SyncingStatus> {
    return this.client.get<boolean | SyncingStatus>("/syncing");
  }

  public async getChainHead(): Promise<BeaconBlock> {
    throw new Error("Method not implemented.");
  }
  public async getBeaconState(): Promise<BeaconState> {
    throw new Error("Method not implemented.");
  }
}
