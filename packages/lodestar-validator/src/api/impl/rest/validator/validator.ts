import {
  Attestation,
  BeaconBlock,
  BLSPubkey,
  BLSSignature,
  Bytes96,
  CommitteeIndex,
  Slot,
  ValidatorDuty,
  SignedBeaconBlock
} from "@chainsafe/eth2.0-types";
import {IValidatorApi} from "../../../interface/validators";
import {HttpClient} from "../../../../util";
import {ILogger} from "@chainsafe/eth2.0-utils/lib/logger";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {fromJson, toHex, toJson, fromHex} from "@chainsafe/eth2.0-utils";

export class RestValidatorApi implements IValidatorApi {

  private readonly client: HttpClient;

  private readonly config: IBeaconConfig;

  public constructor(config: IBeaconConfig, restUrl: string, logger: ILogger) {
    this.client = new HttpClient({urlPrefix: `${restUrl}/validator`}, {logger});
    this.config = config;
  }

  public async getProposerDuties(epoch: number): Promise<Map<Slot, BLSPubkey>> {
    const url = `/duties/${epoch.toString()}/proposer`;
    const responseData = await this.client.get<Record<Slot, string>>(url);

    const result = new Map<Slot, BLSPubkey>();
    for(const [key, value] of Object.entries(responseData)) {
      result.set(Number(key), fromHex(value));
    }
    return result;
  }

  public async getAttesterDuties(epoch: number, validatorPubKeys: Buffer[]): Promise<ValidatorDuty[]> {
    const hexPubKeys = validatorPubKeys.map(toHex);
    const url = `/duties/${epoch.toString()}/attester?validator_pubkeys=${JSON.stringify(hexPubKeys)}`;
    const responseData = await this.client.get<object[]>(url);
    return responseData.map(value => fromJson<ValidatorDuty>(this.config.types.ValidatorDuty, value));
  }

  public async publishAggregatedAttestation(
    aggregatedAttestation: Attestation,
    validatorPubkey: BLSPubkey,
    slotSignature: BLSSignature
  ): Promise<void> {
    return this.client.post(
      `/aggregate?validator_pubkey=${toHex(validatorPubkey)}&slot_signature=${toHex(slotSignature)}`,
      toJson(aggregatedAttestation)
    );
  }

  public async getWireAttestations(epoch: number, committeeIndex: number): Promise<Attestation[]> {
    const url = `/wire_attestations?epoch=${epoch}&committee_index=${committeeIndex}`;
    const responseData = await this.client.get<object[]>(url);
    return responseData.map(value => fromJson<Attestation>(this.config.types.Attestation, value));
  }

  public async produceBlock(slot: Slot, randaoReveal: Bytes96): Promise<BeaconBlock> {
    const url = `/block?slot=${slot}&randao_reveal=${toHex(randaoReveal)}`;
    return fromJson<BeaconBlock>(this.config.types.BeaconBlock, await this.client.get<object>(url));
  }

  public async produceAttestation(
    validatorPubKey: BLSPubkey,
    pocBit: boolean,
    slot: Slot,
    committeeIndex: CommitteeIndex
  ): Promise<Attestation> {
    const url = "/attestation"
        +`?slot=${slot}&committee_index=${committeeIndex}&validator_pubkey=${toHex(validatorPubKey)}`;
    return fromJson<Attestation>(this.config.types.Attestation, await this.client.get<object>(url));
  }

  public async publishBlock(signedBlock: SignedBeaconBlock): Promise<void> {
    return this.client.post("/block", toJson(signedBlock));
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    return this.client.post("/attestation", toJson(attestation));
  }

  public async isAggregator(slot: Slot, committeeIndex: CommitteeIndex, slotSignature: BLSSignature): Promise<boolean> {
    return this.client.get<boolean>(
      `/duties/${slot}/aggregator?committee_index=${committeeIndex}&slot_signature=${toHex(slotSignature)}`
    );
  }
}
