import {byteArrayEquals, toHexString} from "@chainsafe/ssz";
import {allForks, bellatrix, Slot, Root, BLSPubkey, ssz, deneb, Wei} from "@lodestar/types";
import {parseExecutionPayloadAndBlobsBundle, reconstructFullBlockOrContents} from "@lodestar/state-transition";
import {ChainForkConfig} from "@lodestar/config";
import {Logger} from "@lodestar/logger";
import {getClient, Api as BuilderApi} from "@lodestar/api/builder";
import {SLOTS_PER_EPOCH, ForkExecution} from "@lodestar/params";
import {toSafePrintableUrl} from "@lodestar/utils";
import {ApiError} from "@lodestar/api";
import {Metrics} from "../../metrics/metrics.js";
import {IExecutionBuilder} from "./interface.js";

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

export class ExecutionBuilderHttp implements IExecutionBuilder {
  readonly api: BuilderApi;
  readonly config: ChainForkConfig;
  readonly issueLocalFcUWithFeeRecipient?: string;
  // Builder needs to be explicity enabled using updateStatus
  status = false;
  faultInspectionWindow: number;
  allowedFaults: number;

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
        timeoutMs: opts.timeout,
        extraHeaders: opts.userAgent ? {"User-Agent": opts.userAgent} : undefined,
      },
      {config, metrics: metrics?.builderHttpClient}
    );
    logger?.info("External builder", {url: toSafePrintableUrl(baseUrl)});
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
      await this.api.status();
    } catch (e) {
      // Disable if the status was enabled
      this.status = false;
      throw e;
    }
  }

  async registerValidator(registrations: bellatrix.SignedValidatorRegistrationV1[]): Promise<void> {
    ApiError.assert(
      await this.api.registerValidator(registrations),
      "Failed to forward validator registrations to connected builder"
    );
  }

  async getHeader(
    fork: ForkExecution,
    slot: Slot,
    parentHash: Root,
    proposerPubKey: BLSPubkey
  ): Promise<{
    header: allForks.ExecutionPayloadHeader;
    executionPayloadValue: Wei;
    blobKzgCommitments?: deneb.BlobKzgCommitments;
  }> {
    const res = await this.api.getHeader(slot, parentHash, proposerPubKey);
    ApiError.assert(res, "execution.builder.getheader");
    const {header, value: executionPayloadValue} = res.response.data.message;
    const {blobKzgCommitments} = res.response.data.message as deneb.BuilderBid;
    return {header, executionPayloadValue, blobKzgCommitments};
  }

  async submitBlindedBlock(
    signedBlindedBlock: allForks.SignedBlindedBeaconBlock
  ): Promise<allForks.SignedBeaconBlockOrContents> {
    const res = await this.api.submitBlindedBlock(signedBlindedBlock);
    ApiError.assert(res, "execution.builder.submitBlindedBlock");
    const {data} = res.response;

    const {executionPayload, blobsBundle} = parseExecutionPayloadAndBlobsBundle(data);
    // some validations for execution payload
    const expectedTransactionsRoot = signedBlindedBlock.message.body.executionPayloadHeader.transactionsRoot;
    const actualTransactionsRoot = ssz.bellatrix.Transactions.hashTreeRoot(executionPayload.transactions);
    if (!byteArrayEquals(expectedTransactionsRoot, actualTransactionsRoot)) {
      throw Error(
        `Invalid transactionsRoot of the builder payload, expected=${toHexString(
          expectedTransactionsRoot
        )}, actual=${toHexString(actualTransactionsRoot)}`
      );
    }

    const contents = blobsBundle ? {blobs: blobsBundle.blobs, kzgProofs: blobsBundle.proofs} : null;
    return reconstructFullBlockOrContents(signedBlindedBlock, {executionPayload, contents});
  }
}
