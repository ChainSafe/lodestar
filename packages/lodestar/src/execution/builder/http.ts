import {bellatrix, Slot, Root, BLSPubkey, ssz} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {getClient, Api as BuilderApi} from "@chainsafe/lodestar-api/builder";
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
  readonly issueLocalFcUForBlockProduction?: boolean;

  constructor(opts: ExecutionBuilderHttpOpts, config: IChainForkConfig) {
    const baseUrl = opts.urls[0];
    if (!baseUrl) throw Error("No Url provided for executionBuilder");
    this.api = getClient({baseUrl, timeoutMs: opts.timeout}, {config});
    this.issueLocalFcUForBlockProduction = opts.issueLocalFcUForBlockProduction;
  }

  async registerValidator(registrations: bellatrix.SignedValidatorRegistrationV1[]): Promise<void> {
    return this.api.registerValidator(registrations);
  }

  async getPayloadHeader(
    slot: Slot,
    parentHash: Root,
    proposerPubKey: BLSPubkey
  ): Promise<bellatrix.ExecutionPayloadHeader> {
    const {data: signedBid} = await this.api.getPayloadHeader(slot, parentHash, proposerPubKey);
    const executionPayloadHeader = signedBid.message.header;
    return executionPayloadHeader;
  }

  async submitSignedBlindedBlock(
    signedBlock: bellatrix.SignedBlindedBeaconBlock
  ): Promise<bellatrix.SignedBeaconBlock> {
    const {data: executionPayload} = await this.api.submitSignedBlindedBlock(signedBlock);
    const expectedTransactionsRoot = signedBlock.message.body.executionPayloadHeader.transactionsRoot;
    const actualTransactionsRoot = ssz.bellatrix.Transactions.hashTreeRoot(executionPayload.transactions);
    if (!byteArrayEquals(expectedTransactionsRoot, actualTransactionsRoot)) {
      throw Error(
        `Invald transactionsRoot of the builder payload, expected=${toHexString(
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
}
