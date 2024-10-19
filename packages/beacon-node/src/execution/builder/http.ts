import {
  bellatrix,
  Slot,
  Root,
  BLSPubkey,
  deneb,
  Wei,
  SignedBeaconBlockOrContents,
  SignedBlindedBeaconBlock,
  ExecutionPayloadHeader,
  electra,
} from "@lodestar/types";
import {parseExecutionPayloadAndBlobsBundle, reconstructFullBlockOrContents} from "@lodestar/state-transition";
import {ChainForkConfig} from "@lodestar/config";
import {Logger} from "@lodestar/logger";
import {getClient, ApiClient as BuilderApi} from "@lodestar/api/builder";
import {SLOTS_PER_EPOCH, ForkExecution} from "@lodestar/params";
import {toPrintableUrl} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {IExecutionBuilder} from "./interface.js";
import {WireFormat} from "@lodestar/api";

export type ExecutionBuilderHttpOpts = {
  enabled: boolean;
  url: string;
  timeout?: number;
  faultInspectionWindow?: number;
  allowedFaults?: number;

  // Only required for merge-mock runs, no need to expose it to cli
  issueLocalFcUWithFeeRecipient?: string;
  // Add User-Agent header to all requests
  userAgent?: string;
};

export const defaultExecutionBuilderHttpOpts: ExecutionBuilderHttpOpts = {
  enabled: false,
  url: "http://localhost:8661",
  timeout: 12000,
};

/**
 * Duration given to the builder to provide a `SignedBuilderBid` before the deadline
 * is reached, aborting the external builder flow in favor of the local build process.
 */
const BUILDER_PROPOSAL_DELAY_TOLERANCE = 1000;

export class ExecutionBuilderHttp implements IExecutionBuilder {
  readonly api: BuilderApi;
  readonly config: ChainForkConfig;
  readonly issueLocalFcUWithFeeRecipient?: string;
  // Builder needs to be explicity enabled using updateStatus
  status = false;
  faultInspectionWindow: number;
  allowedFaults: number;

  /**
   * Determine if SSZ is supported by requesting an SSZ encoded response in the `getHeader` request.
   * The builder responding with a SSZ serialized `SignedBuilderBid` indicates support to handle the
   * `SignedBlindedBeaconBlock` as SSZ serialized bytes instead of JSON when calling `submitBlindedBlock`.
   */
  private sszSupported = false;

  constructor(
    opts: ExecutionBuilderHttpOpts,
    config: ChainForkConfig,
    metrics: Metrics | null = null,
    logger?: Logger
  ) {
    const baseUrl = opts.url;
    if (!baseUrl) throw Error("No Url provided for executionBuilder");
    this.api = getClient(
      {
        baseUrl,
        globalInit: {
          timeoutMs: opts.timeout,
          headers: opts.userAgent ? {"User-Agent": opts.userAgent} : undefined,
        },
      },
      {config, metrics: metrics?.builderHttpClient, logger}
    );
    logger?.info("External builder", {url: toPrintableUrl(baseUrl)});
    this.config = config;
    this.issueLocalFcUWithFeeRecipient = opts.issueLocalFcUWithFeeRecipient;

    /**
     * Beacon clients select randomized values from the following ranges when initializing
     * the circuit breaker (so at boot time and once for each unique boot).
     *
     * ALLOWED_FAULTS: between 1 and SLOTS_PER_EPOCH // 2
     * FAULT_INSPECTION_WINDOW: between SLOTS_PER_EPOCH and 2 * SLOTS_PER_EPOCH
     *
     */
    this.faultInspectionWindow = Math.max(
      opts.faultInspectionWindow ?? SLOTS_PER_EPOCH + Math.floor(Math.random() * SLOTS_PER_EPOCH),
      SLOTS_PER_EPOCH
    );
    // allowedFaults should be < faultInspectionWindow, limiting them to faultInspectionWindow/2
    this.allowedFaults = Math.min(
      opts.allowedFaults ?? Math.floor(this.faultInspectionWindow / 2),
      Math.floor(this.faultInspectionWindow / 2)
    );
  }

  updateStatus(shouldEnable: boolean): void {
    this.status = shouldEnable;
  }

  async checkStatus(): Promise<void> {
    try {
      (await this.api.status()).assertOk();
    } catch (e) {
      // Disable if the status was enabled
      this.status = false;
      throw e;
    }
  }

  async registerValidator(registrations: bellatrix.SignedValidatorRegistrationV1[]): Promise<void> {
    (await this.api.registerValidator({registrations})).assertOk();
  }

  async getHeader(
    _fork: ForkExecution,
    slot: Slot,
    parentHash: Root,
    proposerPubkey: BLSPubkey
  ): Promise<{
    header: ExecutionPayloadHeader;
    executionPayloadValue: Wei;
    blobKzgCommitments?: deneb.BlobKzgCommitments;
    executionRequests?: electra.ExecutionRequests;
  }> {
    const res = await this.api.getHeader(
      {slot, parentHash, proposerPubkey},
      {timeoutMs: BUILDER_PROPOSAL_DELAY_TOLERANCE}
    );
    const signedBuilderBid = res.value();

    if (!signedBuilderBid) {
      throw Error("No bid received");
    }

    this.sszSupported = res.wireFormat() === WireFormat.ssz;

    const {header, value: executionPayloadValue} = signedBuilderBid.message;
    const {blobKzgCommitments} = signedBuilderBid.message as deneb.BuilderBid;
    const {executionRequests} = signedBuilderBid.message as electra.BuilderBid;
    return {header, executionPayloadValue, blobKzgCommitments, executionRequests};
  }

  async submitBlindedBlock(
    signedBlindedBlock: SignedBlindedBeaconBlock,
    blockBytes?: Uint8Array | null
  ): Promise<SignedBeaconBlockOrContents> {
    const res = await this.api.submitBlindedBlock(
      {signedBlindedBlock, blockBytes},
      {retries: 2, requestWireFormat: this.sszSupported ? WireFormat.ssz : WireFormat.json}
    );

    const {executionPayload, blobsBundle} = parseExecutionPayloadAndBlobsBundle(res.value());

    // for the sake of timely proposals we can skip matching the payload with payloadHeader
    // if the roots (transactions, withdrawals) don't match, this will likely lead to a block with
    // invalid signature, but there is no recourse to this anyway so lets just proceed and will
    // probably need diagonis if this block turns out to be invalid because of some bug
    //
    const contents = blobsBundle ? {blobs: blobsBundle.blobs, kzgProofs: blobsBundle.proofs} : null;
    return reconstructFullBlockOrContents(signedBlindedBlock, {executionPayload, contents});
  }
}
