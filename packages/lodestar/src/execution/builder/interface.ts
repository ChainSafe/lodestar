import {bellatrix, Root, Slot, BLSPubkey} from "@chainsafe/lodestar-types";

export interface IExecutionBuilder {
  /**
   * This param is only to for testing scripts using merge-mock which need
   * an advance fcU to be issued to the engine port before payload header
   * fetch
   */
  readonly issueLocalFcUForBlockProduction?: boolean;
  registerValidator(registrations: bellatrix.SignedValidatorRegistrationV1[]): Promise<void>;
  getPayloadHeader(slot: Slot, parentHash: Root, proposerPubKey: BLSPubkey): Promise<bellatrix.ExecutionPayloadHeader>;
  submitSignedBlindedBlock(signedBlock: bellatrix.SignedBlindedBeaconBlock): Promise<bellatrix.SignedBeaconBlock>;
}
