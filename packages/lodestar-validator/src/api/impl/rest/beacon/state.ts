import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Fork, BLSPubkey, ValidatorIndex, ValidatorResponse} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Json} from "@chainsafe/ssz";
import {HttpClient} from "../../../../util/httpClient";
import {IBeaconStateApi} from "../../../interface/beacon";

export class RestBeaconStateApi implements IBeaconStateApi {
  private readonly client: HttpClient;
  private readonly logger: ILogger;
  private readonly config: IBeaconConfig;

  public constructor(config: IBeaconConfig, client: HttpClient, logger: ILogger) {
    this.client = client;
    this.logger = logger;
    this.config = config;
  }
  public async getStateValidator(
    stateId: "head",
    validatorId: ValidatorIndex | BLSPubkey
  ): Promise<ValidatorResponse | null> {
    let id = "";
    if (typeof validatorId === "number") {
      id = validatorId.toString();
    } else {
      id = this.config.types.BLSPubkey.toJson(validatorId)?.toString() ?? "";
    }
    try {
      return this.config.types.ValidatorResponse.fromJson(
        (await this.client.get<{data: Json}>(`/states/${stateId}/validators/${id}`)).data,
        {
          case: "snake",
        }
      );
    } catch (e) {
      this.logger.error("Failed to fetch validator", {validatorId: id, reason: e.message});
      return null;
    }
  }
  public async getFork(stateId: "head"): Promise<Fork | null> {
    try {
      return this.config.types.Fork.fromJson((await this.client.get<{data: Json}>(`/states/${stateId}/fork`)).data, {
        case: "snake",
      });
    } catch (e) {
      this.logger.error("Failed to fetch head fork version", {reason: e.message});
      return null;
    }
  }
}
