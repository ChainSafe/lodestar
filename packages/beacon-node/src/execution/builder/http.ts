import {allForks, bellatrix, Slot, Root, BLSPubkey, ssz, deneb, Wei} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {getClient, Api as BuilderApi} from "@lodestar/api/builder";
import {byteArrayEquals, toHexString} from "@chainsafe/ssz";
import {SLOTS_PER_EPOCH} from "@lodestar/params";

import {ApiError} from "@lodestar/api";
import {validateBlobsAndKzgCommitments} from "../../chain/produceBlock/validateBlobsAndKzgCommitments.js";
import {Metrics} from "../../metrics/metrics.js";
import {IExecutionBuilder} from "./interface.js";

export type ExecutionBuilderHttpOpts = {
  enabled: boolean;
  urls: string[];
  timeout?: number;
  faultInspectionWindow?: number;
  allowedFaults?: number;

  // Only required for merge-mock runs, no need to expose it to cli
  issueLocalFcUForBlockProduction?: boolean;
};

export const defaultExecutionBuilderHttpOpts: ExecutionBuilderHttpOpts = {
  enabled: false,
  urls: ["http://localhost:8661"],
  timeout: 12000,
};

export class ExecutionBuilderHttp implements IExecutionBuilder {
  readonly api: BuilderApi;
  readonly config: ChainForkConfig;
  readonly issueLocalFcUForBlockProduction?: boolean;
  // Builder needs to be explicity enabled using updateStatus
  status = false;
  faultInspectionWindow: number;
  allowedFaults: number;

  constructor(opts: ExecutionBuilderHttpOpts, config: ChainForkConfig, metrics: Metrics | null = null) {
    const baseUrl = opts.urls[0];
    if (!baseUrl) throw Error("No Url provided for executionBuilder");
    this.api = getClient({baseUrl, timeoutMs: opts.timeout}, {config, metrics: metrics?.builderHttpClient});
    this.config = config;
    this.issueLocalFcUForBlockProduction = opts.issueLocalFcUForBlockProduction;

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
    ApiError.assert(await this.api.registerValidator(registrations));
  }

  async getHeader(
    slot: Slot,
    parentHash: Root,
    proposerPubKey: BLSPubkey
  ): Promise<{
    header: allForks.ExecutionPayloadHeader;
    blockValue: Wei;
    blobKzgCommitments?: deneb.BlobKzgCommitments;
  }> {
    const res = await this.api.getHeader(slot, parentHash, proposerPubKey);
    ApiError.assert(res, "execution.builder.getheader");
    const {header, value: blockValue} = res.response.data.message;
    const {blobKzgCommitments} = res.response.data.message as {blobKzgCommitments?: deneb.BlobKzgCommitments};
    return {header, blockValue, blobKzgCommitments};
  }

  async submitBlindedBlock(signedBlock: allForks.SignedBlindedBeaconBlock): Promise<allForks.SignedBeaconBlock> {
    const res = await this.api.submitBlindedBlock(signedBlock);
    ApiError.assert(res, "execution.builder.submitBlindedBlock");
    const executionPayload = res.response.data;
    const expectedTransactionsRoot = signedBlock.message.body.executionPayloadHeader.transactionsRoot;
    const actualTransactionsRoot = ssz.bellatrix.Transactions.hashTreeRoot(res.response.data.transactions);
    if (!byteArrayEquals(expectedTransactionsRoot, actualTransactionsRoot)) {
      throw Error(
        `Invalid transactionsRoot of the builder payload, expected=${toHexString(
          expectedTransactionsRoot
        )}, actual=${toHexString(actualTransactionsRoot)}`
      );
    }
    const fullySignedBlock: bellatrix.SignedBeaconBlock = {
      ...signedBlock,
      message: {...signedBlock.message, body: {...signedBlock.message.body, executionPayload}},
    };
    return fullySignedBlock;
  }

  async submitBlindedBlockV2(
    signedBlock: allForks.SignedBlindedBeaconBlock
  ): Promise<allForks.SignedBeaconBlockAndBlobsSidecar> {
    const res = await this.api.submitBlindedBlockV2(signedBlock);
    ApiError.assert(res, "execution.builder.submitBlindedBlockV2");
    const signedBeaconBlockAndBlobsSidecar = res.response.data;
    // Since we get the full block back, we can just just compare the hash of blinded to returned
    const {beaconBlock, blobsSidecar} = signedBeaconBlockAndBlobsSidecar;

    // Verify if the transactions and withdrawals match with their corresponding roots
    // since we get the full signed block back, its easy to validate response consistency
    // if the signed blinded and signed full root simply match
    const signedBlockRoot = this.config
      .getBlindedForkTypes(signedBlock.message.slot)
      .SignedBeaconBlock.hashTreeRoot(signedBlock);
    const beaconBlockRoot = this.config
      .getForkTypes(beaconBlock.message.slot)
      .SignedBeaconBlock.hashTreeRoot(beaconBlock);
    if (!byteArrayEquals(signedBlockRoot, beaconBlockRoot)) {
      throw Error(
        `Invalid SignedBeaconBlock of the builder submitBlindedBlockV2 response, expected=${toHexString(
          signedBlockRoot
        )}, actual=${toHexString(beaconBlockRoot)}`
      );
    }

    // Sanity check consistency between payload and blobs bundle still needs to be done
    const payload = beaconBlock.message.body.executionPayload;
    const blockHash = toHexString(payload.blockHash);
    const blobsBlockHash = toHexString(blobsSidecar.beaconBlockRoot);
    if (blockHash !== blobsBlockHash) {
      throw Error(`blobsSidecar incorrect blockHash expected=${blockHash}, actual=${blobsBlockHash}`);
    }
    // Sanity-check that the KZG commitments match the versioned hashes in the transactions
    const {blobKzgCommitments: kzgs} = beaconBlock.message.body as deneb.BeaconBlockBody;
    if (kzgs === undefined) {
      throw Error("Missing blobKzgCommitments on beaconBlock's body");
    }
    const {blobs} = blobsSidecar;
    validateBlobsAndKzgCommitments(payload, {blockHash, kzgs, blobs});

    return signedBeaconBlockAndBlobsSidecar;
  }
}
