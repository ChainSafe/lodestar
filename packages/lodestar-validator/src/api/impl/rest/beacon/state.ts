import {BLSPubkey, ValidatorIndex, phase0} from "@chainsafe/lodestar-types";
import {toJson} from "@chainsafe/lodestar-utils";
import {Json} from "@chainsafe/ssz";
import {IBeaconStateApi} from "../../../interface/beacon";
import {RestApi} from "./abstract";

export class RestBeaconStateApi extends RestApi implements IBeaconStateApi {
  /**
   * Fetch given validator from a given state
   */
  async getStateValidator(
    stateId: "head",
    validatorId: ValidatorIndex | BLSPubkey
  ): Promise<phase0.ValidatorResponse | null> {
    let id = "";
    if (typeof validatorId === "number") {
      id = validatorId.toString();
    } else {
      id = this.config.types.BLSPubkey.toJson(validatorId)?.toString() ?? "";
    }
    try {
      return this.config.types.phase0.ValidatorResponse.fromJson(
        (await this.client.get<{data: Json}>(`/states/${stateId}/validators/${id}`)).data,
        {
          case: "snake",
        }
      );
    } catch (e) {
      this.logger.error("Failed to fetch validator", {validatorId: id, error: (e as Error).message});
      return null;
    }
  }

  /**
   * Fetch the state validators (and filter them if needed)
   */
  async getStateValidators(stateId: "head", filters?: string[]): Promise<phase0.ValidatorResponse[] | null> {
    try {
      const responseData = await this.client.get<{data: Json[]}>(`/states/${stateId}/validators`, {
        filters: filters || [],
      });
      return responseData.data.map((value) =>
        this.config.types.phase0.ValidatorResponse.fromJson(value, {case: "snake"})
      );
    } catch (e) {
      this.logger.error("Failed to fetch validators", {
        filters: toJson(filters),
        error: (e as Error).message,
      });
      return null;
    }
  }

  async getFork(stateId: "head"): Promise<phase0.Fork | null> {
    try {
      return this.config.types.phase0.Fork.fromJson(
        (await this.client.get<{data: Json}>(`/states/${stateId}/fork`)).data,
        {
          case: "snake",
        }
      );
    } catch (e) {
      this.logger.error("Failed to fetch head fork version", {error: (e as Error).message});
      return null;
    }
  }
}
