import { IValidatorApi } from "../../../api/rpc";
import { HttpClient } from "../../../util/httpClient";
import { BeaconBlock, Attestation, ValidatorDuty, Slot, Epoch, bytes96, Shard, BLSPubkey } from "@chainsafe/eth2.0-types";
import { ILogger } from "../../../logger";
import { ApiNamespace } from "../../../api";

export class RestValidatorApi implements IValidatorApi {
  public namespace: ApiNamespace;
  private client: HttpClient;
  public constructor(restUrl: string, logger: ILogger) {
    this.namespace = ApiNamespace.VALIDATOR;
    this.client = new HttpClient({urlPrefix: `${restUrl}/validator`}, {logger});
  }

  public async getDuties(validatorPublicKeys: BLSPubkey[], epoch: Epoch): Promise<ValidatorDuty[]> {
    const hexPubKeys = validatorPublicKeys.map(key => key.toString("hex"));
    const url = `/duties?validator_pubkeys=${JSON.stringify(hexPubKeys)}&epoch=${epoch.toString()}`;
    return this.client.get<ValidatorDuty[]>(url);
  }

  public async produceBlock(slot: Slot, randaoReveal: bytes96): Promise<BeaconBlock> {
    const url = `/block?slot=${slot}&randao_reveal=${randaoReveal.toString("hex")}`;
    return this.client.get<BeaconBlock>(url);
  }

  public async produceAttestation(validatorPubKey: BLSPubkey, pocBit: boolean, slot: Slot, shard: Shard): Promise<Attestation> {
    const url = `/attestation?slot=${slot}&shard=${shard}&validator_pubkey=${validatorPubKey.toString("hex")}`;
    return this.client.get<Attestation>(url);
  }

  public async publishBlock(beaconBlock: BeaconBlock): Promise<void> {
    return this.client.post("/block", beaconBlock);
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    return this.client.post("/attestation", attestation);
  }
}