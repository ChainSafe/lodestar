import {Api} from "@lodestar/api";
import {allForks, capella} from "@lodestar/types";
import {getExecutionPayloadForBlockNumber, getExecutionPayloads} from "../utils/consensus.js";
import {bufferToHex, hexToNumber} from "../utils/conversion.js";
import {OrderedMap} from "./ordered_map.js";

type BlockELRoot = string;
type BlockCLRoot = string;

/**
 * The in-memory store for the execution payloads to be used to verify the proofs
 */
export class PayloadStore {
  // We store the block numbers only for finalized blocks
  private finalizedRoots = new OrderedMap<BlockELRoot>();

  // Unfinalized blocks are stored by the roots of the beacon chain
  private unfinalizedRoots = new Map<BlockCLRoot, BlockELRoot>();

  // Payloads store with BlockELRoot as key
  private payloads = new Map<BlockELRoot, allForks.ExecutionPayload>();

  private latestBlockRoot: BlockELRoot | null = null;

  constructor(private opts: {api: Api}) {}

  get finalized(): allForks.ExecutionPayload | undefined {
    const finalizedMaxRoot = this.finalizedRoots.get(this.finalizedRoots.max);
    if (finalizedMaxRoot) {
      return this.payloads.get(finalizedMaxRoot);
    }

    return undefined;
  }

  get latest(): allForks.ExecutionPayload | undefined {
    if (this.latestBlockRoot) {
      return this.payloads.get(this.latestBlockRoot);
    }

    return undefined;
  }

  async get(blockId: number | string): Promise<allForks.ExecutionPayload | undefined> {
    // Given block id is a block hash in hex (32 bytes root takes 64 hex chars + 2 for 0x prefix)
    if (typeof blockId === "string" && blockId.startsWith("0x") && blockId.length === 64 + 2) {
      return this.payloads.get(blockId);
    }

    // Given block id is a block number in hex
    if (typeof blockId === "string" && blockId.startsWith("0x")) {
      return this.getOrFetchFinalizedPayload(hexToNumber(blockId));
    }

    // Given block id is a block number in decimal string
    if (typeof blockId === "string" && !blockId.startsWith("0x")) {
      return this.getOrFetchFinalizedPayload(parseInt(blockId, 10));
    }

    // Given block id is a block number in decimal
    if (typeof blockId === "number") {
      return this.getOrFetchFinalizedPayload(blockId);
    }

    return undefined;
  }

  async getOrFetchFinalizedPayload(blockNumber: number): Promise<allForks.ExecutionPayload | undefined> {
    if (blockNumber > this.finalizedRoots.max) {
      throw new Error(
        `Block number ${blockNumber} is higher than the latest finalized block number. We recommend to use block hash for unfinalized blocks.`
      );
    }

    let blockELRoot = this.finalizedRoots.get(blockNumber);
    if (!blockELRoot) {
      const payloads = await getExecutionPayloadForBlockNumber(this.opts.api, this.finalizedRoots.min, blockNumber);
      for (const payload of Object.values(payloads)) {
        this.set(payload, true);
      }
    }

    blockELRoot = this.finalizedRoots.get(blockNumber);
    if (blockELRoot) {
      return this.payloads.get(blockELRoot);
    }

    return undefined;
  }

  set(payload: allForks.ExecutionPayload, finalized: boolean): void {
    const blockRoot = bufferToHex(payload.blockHash);
    this.payloads.set(blockRoot, payload);
    this.latestBlockRoot = blockRoot;

    if (finalized) {
      this.finalizedRoots.set(payload.blockNumber, blockRoot);
    }
  }

  async processLCHeader(header: capella.LightClientHeader, finalized = false): Promise<void> {
    const blockSlot = header.beacon.slot;
    const blockNumber = header.execution.blockNumber;
    const blockELRoot = bufferToHex(header.execution.blockHash);
    const blockCLRoot = bufferToHex(header.beacon.stateRoot);
    const existingELRoot = this.unfinalizedRoots.get(blockCLRoot);

    if (finalized) {
      if (existingELRoot) {
        this.unfinalizedRoots.delete(blockCLRoot);
      } else {
        this.payloads.set(
          bufferToHex(header.execution.blockHash),
          (await getExecutionPayloads(this.opts.api, blockSlot, blockSlot))[blockSlot]
        );
      }
      this.finalizedRoots.set(blockNumber, blockELRoot);

      return;
    }

    if (existingELRoot && existingELRoot === blockELRoot) {
      // We already have the payload for this block
      return;
    }

    if (existingELRoot && existingELRoot !== blockELRoot) {
      // Re-org happened, we need to update the payload
      this.payloads.delete(existingELRoot);
      this.unfinalizedRoots.set(blockCLRoot, blockELRoot);
    }

    this.payloads.set(blockELRoot, (await getExecutionPayloads(this.opts.api, blockSlot, blockSlot))[blockSlot]);
    this.latestBlockRoot = blockELRoot;
  }
}
