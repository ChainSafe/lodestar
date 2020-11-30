import {Attestation} from "@chainsafe/lodestar-types";
import {IBeaconPoolApi} from "../../../interface/beacon";
import {RestApi} from "./abstract";

export class RestBeaconPoolApi extends RestApi implements IBeaconPoolApi {
  public async submitAttestation(attestation: Attestation): Promise<void> {
    return this.client.post("/pool/attestations", this.config.types.Attestation.toJson(attestation, {case: "snake"}));
  }
}
