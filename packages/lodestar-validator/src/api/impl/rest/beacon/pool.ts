import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Attestation} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {HttpClient} from "../../../../util/httpClient";
import {IBeaconPoolApi} from "../../../interface/beacon";
import {RestApi} from "./abstract";

export class RestBeaconPoolApi extends RestApi implements IBeaconPoolApi {
  public constructor(config: IBeaconConfig, client: HttpClient, logger: ILogger) {
    super(config, client, logger);
  }

  public async submitAttestation(attestation: Attestation): Promise<void> {
    return this.client.post("/pool/attestations", this.config.types.Attestation.toJson(attestation, {case: "snake"}));
  }
}
