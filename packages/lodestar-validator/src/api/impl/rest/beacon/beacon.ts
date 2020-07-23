import {
  BeaconBlock,
  BeaconState,
  BLSPubkey,
  Fork,
  Genesis,
  Root,
  Uint64,
  ValidatorResponse
} from "@chainsafe/lodestar-types";
import {IBeaconApi} from "../../../interface/beacon";
import {HttpClient, urlJoin} from "../../../../util";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Json, toHexString} from "@chainsafe/ssz";

export class RestBeaconApi implements IBeaconApi {

  private readonly client: HttpClient;
  private readonly clientV2: HttpClient;

  private readonly logger: ILogger;

  private readonly config: IBeaconConfig;

  public constructor(config: IBeaconConfig, restUrl: string, logger: ILogger) {
    this.client = new HttpClient({urlPrefix: urlJoin(restUrl, "lodestar")}, {logger});
    this.clientV2 = new HttpClient({urlPrefix: urlJoin(restUrl, "/v1/beacon")}, {logger});
    this.logger = logger;
    this.config = config;
  }


  public async getValidator(pubkey: BLSPubkey): Promise<ValidatorResponse|null> {
    return this.config.types.ValidatorResponse.fromJson(
      await this.client.get(`/validators/${toHexString(pubkey)}`)
    );
  }

  public async getFork(): Promise<{fork: Fork; chainId: Uint64; genesisValidatorsRoot: Root}> {
    return this.config.types.ForkResponse.fromJson(await this.client.get<Json>("/fork"), {case: "snake"});
  }

  public async getGenesis(): Promise<Genesis|null> {
    try {
      const genesisResponse = await this.clientV2.get<{data: Json}>("/genesis");
      return this.config.types.Genesis.fromJson(genesisResponse.data, {case: "snake"});
    } catch (e) {
      this.logger.error("Failed to obtain genesis time", e);
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
