import {Attestation, SignedVoluntaryExit} from "@chainsafe/lodestar-types";
import {IBeaconPoolApi} from "../../../interface/beacon";
import {RestApi} from "./abstract";

export class RestBeaconPoolApi extends RestApi implements IBeaconPoolApi {
  public async submitAttestation(attestation: Attestation): Promise<void> {
    return this.client.post("/pool/attestations", this.config.types.Attestation.toJson(attestation, {case: "snake"}));
  }

  public async submitVoluntaryExit(signedVoluntaryExit: SignedVoluntaryExit): Promise<void> {
    return this.client.post(
      "/pool/voluntary_exits",
      this.config.types.SignedVoluntaryExit.toJson(signedVoluntaryExit, {case: "snake"})
    );
  }
}
