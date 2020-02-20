import {Bytes32, Fork, SyncingStatus, BeaconBlock, BeaconState, Number64, Uint64} from "@chainsafe/eth2.0-types";
import {IBeaconApi} from "../../../interface/beacon";
import {HttpClient} from "../../../../util";
import {ILogger} from "@chainsafe/eth2.0-utils/lib/logger";

export class RestBeaconApi implements IBeaconApi {

  private client: HttpClient;

  public constructor(restUrl: string, logger: ILogger) {
    this.client = new HttpClient({urlPrefix: `${restUrl}/node`}, {logger});
  }

  public async getClientVersion(): Promise<Bytes32> {
    return this.client.get<Bytes32>("/version");
  }

  public async getFork(): Promise<{fork: Fork; chainId: Uint64}> {
    return this.client.get<{fork: Fork; chainId: Uint64}>("/fork");
  }

  public async getGenesisTime(): Promise<Number64> {
    return this.client.get<Number64>("/genesis_time");
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
