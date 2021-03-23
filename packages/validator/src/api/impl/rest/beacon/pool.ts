import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconPoolApi} from "../../../interface/beacon";
import {RestApi} from "./abstract";

export class RestBeaconPoolApi extends RestApi implements IBeaconPoolApi {
  async submitAttestation(attestation: phase0.Attestation): Promise<void> {
    return this.client.post(
      "/pool/attestations",
      this.config.types.phase0.Attestation.toJson(attestation, {case: "snake"})
    );
  }

  async submitVoluntaryExit(signedVoluntaryExit: phase0.SignedVoluntaryExit): Promise<void> {
    return this.client.post(
      "/pool/voluntary_exits",
      this.config.types.phase0.SignedVoluntaryExit.toJson(signedVoluntaryExit, {case: "snake"})
    );
  }
}
