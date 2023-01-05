import {allForks, bellatrix, Slot, Root, BLSPubkey, ssz, eip4844} from "@lodestar/types";
import {IChainForkConfig} from "@lodestar/config";
import {getClient, Api as BuilderApi} from "@lodestar/api/builder";
import {byteArrayEquals, toHexString} from "@chainsafe/ssz";

import {IExecutionBuilder} from "./interface.js";

export type ExecutionBuilderHttpOpts = {
  enabled: boolean;
  urls: string[];
  timeout?: number;
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
  readonly config: IChainForkConfig;
  readonly issueLocalFcUForBlockProduction?: boolean;
  // Builder needs to be explicity enabled using updateStatus
  status = false;

  constructor(opts: ExecutionBuilderHttpOpts, config: IChainForkConfig) {
    const baseUrl = opts.urls[0];
    if (!baseUrl) throw Error("No Url provided for executionBuilder");
    this.api = getClient({baseUrl, timeoutMs: opts.timeout}, {config});
    this.config = config;
    this.issueLocalFcUForBlockProduction = opts.issueLocalFcUForBlockProduction;
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
    return this.api.registerValidator(registrations);
  }

  async getHeader(
    slot: Slot,
    parentHash: Root,
    proposerPubKey: BLSPubkey
  ): Promise<{header: allForks.ExecutionPayloadHeader; blobKzgCommitments?: eip4844.BlobKzgCommitments}> {
    const {data: signedBid} = await this.api.getHeader(slot, parentHash, proposerPubKey);
    return signedBid.message;
  }

  async submitBlindedBlock(signedBlock: allForks.SignedBlindedBeaconBlock): Promise<allForks.SignedBeaconBlock> {
    const {data: executionPayload} = await this.api.submitBlindedBlock(signedBlock);
    const expectedTransactionsRoot = signedBlock.message.body.executionPayloadHeader.transactionsRoot;
    const actualTransactionsRoot = ssz.bellatrix.Transactions.hashTreeRoot(executionPayload.transactions);
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
    const {data: signedBeaconBlockAndBlobsSidecar} = await this.api.submitBlindedBlockV2(signedBlock);
    // Since we get the full block back, we can just just compare the hash of blinded to returned
    const {beaconBlock} = signedBeaconBlockAndBlobsSidecar;
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
    return signedBeaconBlockAndBlobsSidecar;
  }
}
