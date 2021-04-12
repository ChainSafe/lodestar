import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconPoolApi} from "../../../interface/beacon";
import {RestApi} from "./abstract";

export class RestBeaconPoolApi extends RestApi implements IBeaconPoolApi {
  async submitAttestations(attestations: phase0.Attestation[]): Promise<void> {
    return this.client.post(
      "/pool/attestations",
      attestations.map((attestation) => this.config.types.phase0.Attestation.toJson(attestation, {case: "snake"}))
    );
  }

  async submitVoluntaryExit(signedVoluntaryExit: phase0.SignedVoluntaryExit): Promise<void> {
    return this.client.post(
      "/pool/voluntary_exits",
      this.config.types.phase0.SignedVoluntaryExit.toJson(signedVoluntaryExit, {case: "snake"})
    );
  }
}
