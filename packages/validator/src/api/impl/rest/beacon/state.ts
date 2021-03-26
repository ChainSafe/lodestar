import {BLSPubkey, ValidatorIndex, phase0} from "@chainsafe/lodestar-types";
import {toJson} from "@chainsafe/lodestar-utils";
import {Json} from "@chainsafe/ssz";
import {IValidatorFilters} from "../../../../util";
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
    const id = this.convertIdToString(validatorId);
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
  async getStateValidators(stateId: "head", filters?: IValidatorFilters): Promise<phase0.ValidatorResponse[] | null> {
    const indices = [];
    if (filters?.indices) {
      for (const index of filters?.indices) {
        indices.push(this.convertIdToString(index));
      }
    }
    if (filters?.statuses) {
      // TODO: account for statuses when needed
    }

    try {
      const responseData = await this.client.get<{data: Json[]}>(`/states/${stateId}/validators`, {
        indices,
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

  private convertIdToString(validatorId: ValidatorIndex | BLSPubkey): string {
    let id = "";
    if (typeof validatorId === "number") {
      id = validatorId.toString();
    } else {
      id = this.config.types.BLSPubkey.toJson(validatorId)?.toString() ?? "";
    }
    return id;
  }
}
