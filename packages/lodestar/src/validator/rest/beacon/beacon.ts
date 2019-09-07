import { IBeaconApi } from "../../../api/rpc";
import { HttpClient } from "../../../util/httpClient";
import { bytes32, Fork, SyncingStatus, BeaconBlock, BeaconState, number64 } from "@chainsafe/eth2.0-types";
import { ILogger } from "../../../logger";
import { ApiNamespace } from "../../../api";

export class RestBeaconApi implements IBeaconApi {
  public namespace: ApiNamespace;
  
  private client: HttpClient;

  public constructor(restUrl: string, logger: ILogger) {
    this.namespace = ApiNamespace.BEACON;
    this.client = new HttpClient({urlPrefix: `${restUrl}/node`}, {logger});
  }

  public async getClientVersion(): Promise<bytes32> {
    return this.client.get<bytes32>("/version");
  }

  public async getFork(): Promise<Fork> {
    return this.client.get<Fork>("/fork");
  }

  public async getGenesisTime(): Promise<number64> {
    return this.client.get<number64>("/genesis_time");
  }

  public async getSyncingStatus(): Promise<boolean | SyncingStatus> {
    return this.client.get<boolean | SyncingStatus>("/syncing")
  }
}