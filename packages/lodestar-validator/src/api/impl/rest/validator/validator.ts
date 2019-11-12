import {
  Attestation,
  BeaconBlock,
  BLSPubkey,
  bytes96,
  Epoch,
  Slot,
  ValidatorDuty,
  ValidatorIndex,
  number64
} from "@chainsafe/eth2.0-types";
import {IValidatorApi} from "../../../interface/validators";
import {HttpClient} from "../../../../util";
import {ILogger} from "../../../..";

export class RestValidatorApi implements IValidatorApi {

  private client: HttpClient;

  public constructor(restUrl: string, logger: ILogger) {
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

  public async produceAttestation(
    validatorPubKey: BLSPubkey,
    pocBit: boolean,
    slot: Slot,
    // Rest API spec uses "shard" but core spec uses "committeeIndex"
    shard: number64
  ): Promise<Attestation> {
    const url = `/attestation?slot=${slot}&shard=${shard}&validator_pubkey=${validatorPubKey.toString("hex")}`;
    return this.client.get<Attestation>(url);
  }

  public async publishBlock(beaconBlock: BeaconBlock): Promise<void> {
    return this.client.post("/block", beaconBlock);
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    return this.client.post("/attestation", attestation);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async getValidatorIndex(pubKey: BLSPubkey): Promise<ValidatorIndex> {
    throw new Error("Method not implemented.");
  }
}
