import {IAttestationFilters, IBeaconPoolApi} from "./interface";
import {Attestation} from "@chainsafe/lodestar-types";
import {IApiOptions} from "../../../options";
import {IApiModules} from "../../../interface";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../../../../db/api";

export class BeaconPoolApi implements IBeaconPoolApi {

  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;

  public constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "config"|"db">) {
    this.config = modules.config;
    this.db = modules.db;
  }

  public async getAttestations(filters: Partial<IAttestationFilters> = {}): Promise<Attestation[]> {
    return (await this.db.attestation.values())
      .filter((attestation) => {
        if(filters.slot && filters.slot !== attestation.data.slot) {
          return false;
        }
        if(filters.committeeIndex && filters.committeeIndex !== attestation.data.index) {
          return false;
        }
        return true;
      });
  }

}
