import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Attestation} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {HttpClient} from "../../../../util/httpClient";
import {IBeaconPoolApi} from "../../../interface/beacon";

export class RestBeaconPoolApi implements IBeaconPoolApi {
  private readonly client: HttpClient;
  private readonly logger: ILogger;
  private readonly config: IBeaconConfig;

  public constructor(config: IBeaconConfig, client: HttpClient, logger: ILogger) {
    this.client = client;
    this.logger = logger;
    this.config = config;
  }
  public async submitAttestation(attestation: Attestation): Promise<void> {
    return this.client.post("/pool/attestations", this.config.types.Attestation.toJson(attestation, {case: "snake"}));
  }
}
