import {BLSPubkey, Fork, ValidatorIndex, ValidatorResponse} from "@chainsafe/lodestar-types";
import {Json} from "@chainsafe/ssz";
import {IBeaconStateApi} from "../../../interface/beacon";
import {RestApi} from "./abstract";

export class RestBeaconStateApi extends RestApi implements IBeaconStateApi {
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
      this.logger.error("Failed to fetch validator", {validatorId: id, error: e.message});
      return null;
    }
  }
  public async getFork(stateId: "head"): Promise<Fork | null> {
    try {
      return this.config.types.Fork.fromJson((await this.client.get<{data: Json}>(`/states/${stateId}/fork`)).data, {
        case: "snake",
      });
    } catch (e) {
      this.logger.error("Failed to fetch head fork version", {error: e.message});
      return null;
    }
  }
}
