import {allForks, bellatrix, Root, Slot, BLSPubkey} from "@lodestar/types";

export interface IExecutionBuilder {
  /**
   * This param is only to for testing scripts using merge-mock which need
   * an advance fcU to be issued to the engine port before payload header
   * fetch
   */
  readonly issueLocalFcUForBlockProduction?: boolean;
  status: boolean;
  updateStatus(shouldEnable: boolean): void;
  checkStatus(): Promise<void>;
  registerValidator(registrations: bellatrix.SignedValidatorRegistrationV1[]): Promise<void>;
  getHeader(slot: Slot, parentHash: Root, proposerPubKey: BLSPubkey): Promise<allForks.ExecutionPayloadHeader>;
  submitBlindedBlock(signedBlock: allForks.SignedBlindedBeaconBlock): Promise<allForks.SignedBeaconBlock>;
}
