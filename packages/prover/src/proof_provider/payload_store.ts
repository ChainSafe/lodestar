import {Api} from "@lodestar/api";
import {allForks, capella} from "@lodestar/types";
import {getExecutionPayloads} from "../utils/consensus.js";
import {bufferToHex, numberToHex} from "../utils/conversion.js";

type BlockELRoot = string;
type BlockCLRoot = string;

export class PayloadStore {
  private finalizedBlockRoot: BlockELRoot | null = null;
  private latestBlockRoot: BlockELRoot | null = null;
  private rootsMap = new Map<BlockCLRoot, BlockELRoot>();
  private blockNumbersMap = new Map<string, BlockELRoot>();
  private payloads = new Map<BlockELRoot, allForks.ExecutionPayload>();

  constructor(private opts: {api: Api}) {}

  get finalized(): allForks.ExecutionPayload | undefined {
    if (this.finalizedBlockRoot) {
      return this.payloads.get(this.finalizedBlockRoot);
    }

    return undefined;
  }

  get latest(): allForks.ExecutionPayload | undefined {
    if (this.latestBlockRoot) {
      return this.payloads.get(this.latestBlockRoot);
    }

    return undefined;
  }

  get(blockId: number | string): allForks.ExecutionPayload | undefined {
    // Given block id is a block hash
    if (typeof blockId === "string" && blockId.startsWith("0x") && blockId.length === 32 + 2) {
      return this.payloads.get(blockId);
    }

    // Given block id is a block number in hex
    if (typeof blockId === "string" && blockId.startsWith("0x")) {
      const blockRoot = this.blockNumbersMap.get(blockId);
      if (blockRoot) {
        return this.payloads.get(blockRoot);
      }
    }

    // Given block id is a block number in decimal string
    if (typeof blockId === "string" && !blockId.startsWith("0x")) {
      const blockRoot = this.blockNumbersMap.get(numberToHex(parseInt(blockId, 10)));
      if (blockRoot) {
        return this.payloads.get(blockRoot);
      }
    }

    // Given block id is a block number in decimal
    if (typeof blockId === "number") {
      const blockRoot = this.blockNumbersMap.get(numberToHex(blockId));
      if (blockRoot) {
        return this.payloads.get(blockRoot);
      }
    }

    return undefined;
  }

  set(payload: allForks.ExecutionPayload, finalized: boolean): void {
    const blockRoot = bufferToHex(payload.blockHash);

    this.payloads.set(blockRoot, payload);

    this.latestBlockRoot = blockRoot;
    if (finalized) {
      this.finalizedBlockRoot = blockRoot;
    }
  }

  async processLCHeader(header: capella.LightClientHeader, finalized = false): Promise<void> {
    const blockSlot = header.beacon.slot;
    const blockNumber = numberToHex(header.execution.blockNumber);
    const blockELRoot = bufferToHex(header.execution.blockHash);
    const blockCLRoot = bufferToHex(header.beacon.stateRoot);

    const existingCLRoot = this.rootsMap.get(blockCLRoot);
    const existingPayload = existingCLRoot ? this.payloads.get(existingCLRoot) : undefined;
    const existingELRoot = existingPayload ? bufferToHex(existingPayload.blockHash) : undefined;

    if (existingPayload && existingELRoot === blockELRoot) {
      if (finalized) {
        this.finalizedBlockRoot = blockELRoot;
      }
      this.latestBlockRoot = blockELRoot;

      // We payload have the payload for this block
      return;
    }

    if (existingPayload && existingELRoot !== blockELRoot) {
      // Re-org happened, we need to update the payload
      this.payloads.delete(blockELRoot);
      this.rootsMap.set(blockCLRoot, blockELRoot);
    }

    const newPayloadHeaders = await getExecutionPayloads(this.opts.api, blockSlot, blockSlot);
    this.payloads.set(blockELRoot, newPayloadHeaders[blockSlot]);
    this.rootsMap.set(blockCLRoot, blockELRoot);
    this.blockNumbersMap.set(blockNumber, blockELRoot);

    if (finalized) {
      this.finalizedBlockRoot = blockELRoot;
    }

    this.latestBlockRoot = blockELRoot;
  }
}
