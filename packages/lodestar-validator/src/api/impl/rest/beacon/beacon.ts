import {
  BeaconBlock,
  BeaconState,
  BLSPubkey,
  Bytes32,
  Fork,
  Number64,
  SyncingStatus,
  Uint64,
  Root,
  ValidatorResponse
} from "@chainsafe/lodestar-types";
import {IBeaconApi} from "../../../interface/beacon";
import {HttpClient} from "../../../../util";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Json, toHexString} from "@chainsafe/ssz";

export class RestBeaconApi implements IBeaconApi {

  private readonly client: HttpClient;

  private readonly logger: ILogger;

  private readonly config: IBeaconConfig;

  public constructor(config: IBeaconConfig, restUrl: string, logger: ILogger) {
    this.client = new HttpClient({urlPrefix: `${restUrl}/node`}, {logger});
    this.logger = logger;
    this.config = config;
  }


  public async getValidator(pubkey: BLSPubkey): Promise<ValidatorResponse|null> {
    return this.config.types.ValidatorResponse.fromJson(
      await this.client.get(`/validators/${toHexString(pubkey)}`)
    );
  }

  public async getClientVersion(): Promise<Bytes32> {
    return this.client.get<Bytes32>("/version");
  }

  public async getFork(): Promise<{fork: Fork; chainId: Uint64; genesisValidatorsRoot: Root}> {
    return this.config.types.ForkResponse.fromJson(await this.client.get<Json>("/fork"), {case: "snake"});
  }

  public async getGenesisTime(): Promise<Number64> {
    try {
      return await this.client.get<Number64>("/genesis_time");
    } catch (e) {
      this.logger.error("Failed to obtain genesis time", e);
      return 0;
    }
  }

  public async getSyncingStatus(): Promise<boolean | SyncingStatus> {
    return this.client.get<boolean | SyncingStatus>("/syncing");
  }

  public async getChainHead(): Promise<BeaconBlock> {
    throw new Error("Method not implemented.");
  }
  public async getBeaconState(): Promise<BeaconState> {
    throw new Error("Method not implemented.");
  }
}
