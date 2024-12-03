import {ForkExecution} from "@lodestar/params";
import {
  BLSPubkey,
  ExecutionPayloadHeader,
  Root,
  SignedBeaconBlockOrContents,
  SignedBlindedBeaconBlock,
  Slot,
  Wei,
  WithOptionalBytes,
  bellatrix,
  deneb,
  electra,
} from "@lodestar/types";

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
    header: ExecutionPayloadHeader;
    executionPayloadValue: Wei;
    blobKzgCommitments?: deneb.BlobKzgCommitments;
    executionRequests?: electra.ExecutionRequests;
  }>;
  submitBlindedBlock(
    signedBlindedBlock: WithOptionalBytes<SignedBlindedBeaconBlock>
  ): Promise<SignedBeaconBlockOrContents>;
}
