import {HttpClient, urlJoin} from "../../../../util";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {INodeApi} from "../../../interface/node";
import {phase0} from "@chainsafe/lodestar-types";
import {Json} from "@chainsafe/ssz";

export class RestNodeApi implements INodeApi {
  private readonly client: HttpClient;

  private readonly config: IBeaconConfig;

  constructor(config: IBeaconConfig, restUrl: string, logger: ILogger) {
    this.client = new HttpClient({urlPrefix: urlJoin(restUrl, "/eth/v1/node")}, {logger});
    this.config = config;
  }

  async getVersion(): Promise<string> {
    return (await this.client.get<{data: {version: string}}>("/version")).data.version;
  }

  async getSyncingStatus(): Promise<phase0.SyncingStatus> {
    return this.config.types.phase0.SyncingStatus.fromJson((await this.client.get<{data: Json}>("/syncing")).data, {
      case: "snake",
    });
  }
}
