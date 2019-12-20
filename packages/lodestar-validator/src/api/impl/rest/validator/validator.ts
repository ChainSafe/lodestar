import {
  Attestation,
  BeaconBlock,
  BLSPubkey,
  BLSSignature,
  bytes96,
  CommitteeIndex,
  Slot,
  ValidatorDuty
} from "@chainsafe/eth2.0-types";
import {IValidatorApi} from "../../../interface/validators";
import {HttpClient} from "../../../../util";
import {ILogger} from "../../../..";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {fromJson, toHex, toJson} from "@chainsafe/eth2.0-utils";

export class RestValidatorApi implements IValidatorApi {

  private readonly client: HttpClient;

  private readonly config: IBeaconConfig;

  public constructor(config: IBeaconConfig, restUrl: string, logger: ILogger) {
    this.client = new HttpClient({urlPrefix: `${restUrl}/validator`}, {logger});
    this.config = config;
  }

  public async getProposerDuties(epoch: number): Promise<Map<number, Buffer>> {
    const url = `/duties/${epoch.toString()}/proposer`;
    const responseData = await this.client.get<Record<Slot, string>>(url);

    const result = new Map<Slot, BLSPubkey>();
    for(const key in responseData) {
      if(responseData.hasOwnProperty(key)) {
        result.set(Number(key), Buffer.from(responseData[key].replace("0x", ""), "hex"));
      }
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

  public async produceBlock(slot: Slot, randaoReveal: bytes96): Promise<BeaconBlock> {
    const url = `/block?slot=${slot}&randao_reveal=${randaoReveal.toString("hex")}`;
    return fromJson<BeaconBlock>(this.config.types.BeaconBlock, await this.client.get<object>(url));
  }

  public async produceAttestation(
    validatorPubKey: BLSPubkey,
    pocBit: boolean,
    slot: Slot,
    committeeIndex: CommitteeIndex
  ): Promise<Attestation> {
    const url = "/attestation"
        +`?slot=${slot}&committee_index=${committeeIndex}&validator_pubkey=${validatorPubKey.toString("hex")}`;
    return fromJson<Attestation>(this.config.types.Attestation, await this.client.get<object>(url));
  }

  public async publishBlock(beaconBlock: BeaconBlock): Promise<void> {
    return this.client.post("/block", toJson(beaconBlock));
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
