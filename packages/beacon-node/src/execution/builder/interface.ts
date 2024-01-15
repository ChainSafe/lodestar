import {allForks, bellatrix, Root, Slot, BLSPubkey, deneb, Wei} from "@lodestar/types";
import {ForkExecution} from "@lodestar/params";

export interface IExecutionBuilder {
  /**
   * This param is only to for testing scripts using merge-mock which need
   * an advance fcU to be issued to the engine port before payload header
   * fetch
   */
  readonly issueLocalFcUWithFeeRecipient?: string;
  status: boolean;
  /** Window to inspect missed slots for enabling/disabling builder circuit breaker */
  faultInspectionWindow: number;
  /** Number of missed slots allowed in the faultInspectionWindow for builder circuit*/
  allowedFaults: number;

  updateStatus(shouldEnable: boolean): void;
  checkStatus(): Promise<void>;
  registerValidator(registrations: bellatrix.SignedValidatorRegistrationV1[]): Promise<void>;
  getHeader(
    fork: ForkExecution,
    slot: Slot,
    parentHash: Root,
    proposerPubKey: BLSPubkey
  ): Promise<{
    header: allForks.ExecutionPayloadHeader;
    executionPayloadValue: Wei;
    blobKzgCommitments?: deneb.BlobKzgCommitments;
  }>;
  submitBlindedBlock(signedBlock: allForks.SignedBlindedBeaconBlock): Promise<allForks.SignedBeaconBlockOrContents>;
}
