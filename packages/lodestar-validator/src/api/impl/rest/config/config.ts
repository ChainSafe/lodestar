import {phase0} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Json} from "@chainsafe/ssz";
import {HttpClient, urlJoin} from "../../../../util";
import {IConfigApi} from "../../../interface/config";

export class RestConfigApi implements IConfigApi {
  private readonly client: HttpClient;

  private readonly config: IBeaconConfig;

  constructor(config: IBeaconConfig, restUrl: string, logger: ILogger) {
    this.client = new HttpClient({urlPrefix: urlJoin(restUrl, "/eth/v1/config")}, {logger});
    this.config = config;
  }

  async getForkSchedule(): Promise<phase0.Fork[]> {
    const data = (await this.client.get<{data: Json}>("/fork_schedule")).data as [];
    return data.map((fork) => this.config.types.phase0.Fork.fromJson(fork));
  }
}
