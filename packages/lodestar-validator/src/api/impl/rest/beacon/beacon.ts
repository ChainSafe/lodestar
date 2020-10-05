import {BeaconBlock, BeaconState, BLSPubkey, Fork, Genesis, ValidatorResponse} from "@chainsafe/lodestar-types";
import {IBeaconApiClient} from "../../../types";
import {HttpClient, urlJoin} from "../../../../util";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Json, toHexString} from "@chainsafe/ssz";

export class RestBeaconApi implements IBeaconApiClient {
  private readonly client: HttpClient;
  private readonly clientV2: HttpClient;

  private readonly logger: ILogger;

  private readonly config: IBeaconConfig;

  public constructor(config: IBeaconConfig, restUrl: string, logger: ILogger) {
    this.client = new HttpClient({urlPrefix: urlJoin(restUrl, "lodestar")}, {logger});
    this.clientV2 = new HttpClient({urlPrefix: urlJoin(restUrl, "/eth/v1/beacon")}, {logger});
    this.logger = logger;
    this.config = config;
  }

  public async getFork(): Promise<Fork | null> {
    try {
      const response = await this.clientV2.get<{data: Json}>("/state/head/fork");
      return this.config.types.Fork.fromJson(response.data, {case: "snake"});
    } catch (e) {
      this.logger.error("Failed to obtain fork version", {reason: e.message});
      return null;
    }
  }

  public async getValidator(pubkey: BLSPubkey): Promise<ValidatorResponse | null> {
    return this.config.types.ValidatorResponse.fromJson(await this.client.get(`/validators/${toHexString(pubkey)}`));
  }

  public async getGenesis(): Promise<Genesis | null> {
    try {
      const genesisResponse = await this.clientV2.get<{data: Json}>("/genesis");
      return this.config.types.Genesis.fromJson(genesisResponse.data, {case: "snake"});
    } catch (e) {
      this.logger.error("Failed to obtain genesis time", {reason: e.message});
      return null;
    }
  }

  public async getChainHead(): Promise<BeaconBlock> {
    throw new Error("Method not implemented.");
  }
  public async getBeaconState(): Promise<BeaconState> {
    throw new Error("Method not implemented.");
  }
}
