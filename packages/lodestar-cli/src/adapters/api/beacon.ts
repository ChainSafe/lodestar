import {IBeaconApi} from "@chainsafe/lodestar/lib/api";
import {BLSPubkey, Fork, Genesis, ValidatorResponse} from "@chainsafe/lodestar-types";
import {IBeaconApiClient} from "@chainsafe/lodestar-validator";

export class ValidatorBeaconApiAdapter implements IBeaconApiClient {
  private readonly api: IBeaconApi;

  constructor(api: IBeaconApi) {
    this.api = api;
  }

  public getFork(): Promise<Fork | null> {
    return this.api.state.getFork("head");
  }
  /**
   * Requests the BeaconNode to provide validator details for given public key.
   */
  public getValidator(pubkey: BLSPubkey): Promise<ValidatorResponse | null> {
    return this.api.getValidator(pubkey);
  }

  public getGenesis(): Promise<Genesis | null> {
    return this.api.getGenesis();
  }
}
