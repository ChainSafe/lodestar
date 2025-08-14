import {ForkPostBellatrix} from "@lodestar/params";
import {
  BLSPubkey,
  Epoch,
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
import {ValidatorRegistration} from "./cache.js";
import {BuilderStatus} from "./http.js";

export interface IExecutionBuilder {
  /**
   * This param is only to for testing scripts using merge-mock which need
   * an advance fcU to be issued to the engine port before payload header
   * fetch
   */
  readonly issueLocalFcUWithFeeRecipient?: string;
  status: BuilderStatus;
  /** Window to inspect missed slots for enabling/disabling builder circuit breaker */
  faultInspectionWindow: number;
  /** Number of missed slots allowed in the faultInspectionWindow for builder circuit*/
  allowedFaults: number;

  updateStatus(status: BuilderStatus): void;
  checkStatus(): Promise<void>;
  registerValidator(epoch: Epoch, registrations: bellatrix.SignedValidatorRegistrationV1[]): Promise<void>;
  getValidatorRegistration(pubkey: BLSPubkey): ValidatorRegistration | undefined;
  getHeader(
    fork: ForkPostBellatrix,
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
  submitBlindedBlockNoResponse(signedBlindedBlock: WithOptionalBytes<SignedBlindedBeaconBlock>): Promise<void>;
}
