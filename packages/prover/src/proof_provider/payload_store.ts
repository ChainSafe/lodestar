import {Api} from "@lodestar/api";
import {allForks, capella} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {MAX_PAYLOAD_HISTORY} from "../constants.js";
import {getExecutionPayloadForBlockNumber, getExecutionPayloads} from "../utils/consensus.js";
import {bufferToHex, hexToNumber} from "../utils/conversion.js";
import {OrderedMap} from "./ordered_map.js";

type BlockELRoot = string;
type BlockCLRoot = string;

/**
 * The in-memory store for the execution payloads to be used to verify the proofs
 */
export class PayloadStore {
  // We store the block root from execution for finalized blocks
  // As these blocks are finalized, so not to be worried about conflicting roots
  private finalizedRoots = new OrderedMap<BlockELRoot>();

  // Unfinalized blocks may change over time and may have conflicting roots
  // We can receive multiple light-client headers for the same block of execution
  // So we why store unfinalized payloads by their CL root, which is only used
  // in processing the light-client headers
  private unfinalizedRoots = new Map<BlockCLRoot, BlockELRoot>();

  // Payloads store with BlockELRoot as key
  private payloads = new Map<BlockELRoot, allForks.ExecutionPayload>();

  private latestBlockRoot: BlockELRoot | null = null;

  constructor(private opts: {api: Api; logger: Logger}) {}

  get finalized(): allForks.ExecutionPayload | undefined {
    const maxBlockNumberForFinalized = this.finalizedRoots.max;

    if (maxBlockNumberForFinalized === undefined) {
      return;
    }

    const finalizedMaxRoot = this.finalizedRoots.get(maxBlockNumberForFinalized);
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

  protected async getOrFetchFinalizedPayload(blockNumber: number): Promise<allForks.ExecutionPayload | undefined> {
    const maxBlockNumberForFinalized = this.finalizedRoots.max;
    const minBlockNumberForFinalized = this.finalizedRoots.min;

    if (maxBlockNumberForFinalized === undefined || minBlockNumberForFinalized === undefined) {
      return;
    }

    if (blockNumber > maxBlockNumberForFinalized) {
      throw new Error(
        `Block number ${blockNumber} is higher than the latest finalized block number. We recommend to use block hash for unfinalized blocks.`
      );
    }

    let blockELRoot = this.finalizedRoots.get(blockNumber);
    // check if we have payload cached locally else fetch from api
    if (!blockELRoot) {
      const payloads = await getExecutionPayloadForBlockNumber(this.opts.api, minBlockNumberForFinalized, blockNumber);
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

    if (this.latestBlockRoot) {
      const latestPayload = this.payloads.get(this.latestBlockRoot);
      if (latestPayload && latestPayload.blockNumber < payload.blockNumber) {
        this.latestBlockRoot = blockRoot;
      }
    } else {
      this.latestBlockRoot = blockRoot;
    }

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

    // ==== Finalized blocks ====
    // if the block is finalized, we need to update the finalizedRoots map
    if (finalized) {
      this.finalizedRoots.set(blockNumber, blockELRoot);

      // If the block is finalized and we already have the payload
      // We can remove it from the unfinalizedRoots map and do nothing else
      if (existingELRoot) {
        this.unfinalizedRoots.delete(blockCLRoot);
      }

      // If the block is finalized and we do not have the payload
      // We need to fetch and set the payload
      else {
        this.payloads.set(
          bufferToHex(header.execution.blockHash),
          (
            await getExecutionPayloads({
              api: this.opts.api,
              startSlot: blockSlot,
              endSlot: blockSlot,
              logger: this.opts.logger,
            })
          )[blockSlot]
        );
      }

      return;
    }

    // ==== Unfinalized blocks ====
    // We already have the payload for this block
    if (existingELRoot && existingELRoot === blockELRoot) {
      return;
    }

    // Re-org happened, we need to update the payload
    if (existingELRoot && existingELRoot !== blockELRoot) {
      this.payloads.delete(existingELRoot);
    }

    // This is unfinalized header we need to store it's root related to cl root
    this.unfinalizedRoots.set(blockCLRoot, blockELRoot);

    // We do not have the payload for this block, we need to fetch it
    const payload = (
      await getExecutionPayloads({
        api: this.opts.api,
        startSlot: blockSlot,
        endSlot: blockSlot,
        logger: this.opts.logger,
      })
    )[blockSlot];
    this.set(payload, false);
    this.prune();
  }

  prune(): void {
    if (this.finalizedRoots.size <= MAX_PAYLOAD_HISTORY) return;
    // Store doe not have any finalized blocks means it's recently initialized
    if (this.finalizedRoots.max === undefined || this.finalizedRoots.min === undefined) return;

    for (
      let blockNumber = this.finalizedRoots.max - MAX_PAYLOAD_HISTORY;
      blockNumber >= this.finalizedRoots.min;
      blockNumber--
    ) {
      const blockELRoot = this.finalizedRoots.get(blockNumber);
      if (blockELRoot) {
        this.payloads.delete(blockELRoot);
        this.finalizedRoots.delete(blockNumber);
      }
    }

    for (const [clRoot, elRoot] of this.unfinalizedRoots) {
      const payload = this.payloads.get(elRoot);
      if (!payload) {
        this.unfinalizedRoots.delete(clRoot);
        continue;
      }

      if (payload.blockNumber < this.finalizedRoots.min) {
        this.unfinalizedRoots.delete(clRoot);
      }
    }
  }
}
