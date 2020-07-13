import {HttpClient, urlJoin} from "../../../../util";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {INodeApi} from "../../../interface/node";
import {SyncingStatus} from "@chainsafe/lodestar-types";
import {Json} from "@chainsafe/ssz/lib/interface";

export class RestNodeApi implements INodeApi {

  private readonly client: HttpClient;

  private readonly config: IBeaconConfig;

  public constructor(config: IBeaconConfig, restUrl: string, logger: ILogger) {
    this.client = new HttpClient({urlPrefix: urlJoin(restUrl, "/v1/node")}, {logger});
    this.config = config;
  }

  public async getVersion(): Promise<string> {
    return (await this.client.get<{data: {version: string}}>("/version")).data.version;
  }

  public async getSyncingStatus(): Promise<SyncingStatus> {
    return this.config.types.SyncingStatus.fromJson(
      (await this.client.get<{data: Json}>("/syncing")).data,
      {case: "snake"}
    );
  }


}
