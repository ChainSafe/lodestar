import { IValidatorDB, IAttestationSearchOptions } from "../../db/interface";
import { BLSPubkey, SignedBeaconBlock, Attestation } from "@chainsafe/eth2.0-types";


export class MockValidatorDB implements IValidatorDB {
  public async getBlock(pubKey: BLSPubkey): Promise<SignedBeaconBlock|null> {
    return null;
  }

  public async setBlock(pubKey: BLSPubkey, block: SignedBeaconBlock): Promise<void> {

  }

  public async getAttestations(pubKey: BLSPubkey, options?: IAttestationSearchOptions): Promise<Attestation[]> {
    return [];
  }

  public async setAttestation(pubKey: BLSPubkey, attestation: Attestation): Promise<void> {

  }

  public async deleteAttestations(pubKey: BLSPubkey, attestation: Attestation[]): Promise<void> {

  }
}