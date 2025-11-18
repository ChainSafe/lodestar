import {type FileHandle, open, rename} from "node:fs/promises";
import {format, parse} from "node:path";
import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {BeaconState, SignedBeaconBlock, Slot} from "@lodestar/types";
import {E2STORE_HEADER_SIZE, EntryType, SlotIndex, serializeSlotIndex, writeEntry} from "../e2s.ts";
import {snappyCompress} from "../util.ts";
import {
  computeStartBlockSlotFromEraNumber,
  getShortHistoricalRoot,
  isSlotInRange,
  isValidEraStateSlot,
} from "./util.ts";

enum WriterStateType {
  InitGroup,
  WriteGroup,
  FinishedGroup,
}

type WriterState =
  | {
      type: WriterStateType.InitGroup;
      eraNumber: number;
      currentOffset: number;
    }
  | {
      type: WriterStateType.WriteGroup;
      eraNumber: number;
      currentOffset: number;
      blockOffsets: number[];
      lastSlot: Slot;
    }
  | {
      type: WriterStateType.FinishedGroup;
      eraNumber: number;
      currentOffset: number;
      shortHistoricalRoot: string;
    };

/**
 * EraWriter is responsible for writing ERA files.
 *
 * See https://github.com/eth-clients/e2store-format-specs/blob/main/formats/era.md
 */
export class EraWriter {
  config: ChainForkConfig;
  path: string;
  fh: FileHandle;
  eraNumber: number;
  state: WriterState;

  constructor(config: ChainForkConfig, path: string, fh: FileHandle, eraNumber: number) {
    this.config = config;
    this.path = path;
    this.fh = fh;
    this.eraNumber = eraNumber;
    this.state = {
      type: WriterStateType.InitGroup,
      eraNumber,
      currentOffset: 0,
    };
  }

  static async create(config: ChainForkConfig, path: string, eraNumber: number): Promise<EraWriter> {
    const fh = await open(path, "w");
    return new EraWriter(config, path, fh, eraNumber);
  }

  async finish(): Promise<string> {
    if (this.state.type !== WriterStateType.FinishedGroup) {
      throw new Error("Writer has not been finished");
    }
    await this.fh.close();

    const pathParts = parse(this.path);
    const newPath = format({
      ...pathParts,
      base: `${this.config.CONFIG_NAME}-${String(this.eraNumber).padStart(5, "0")}-${this.state.shortHistoricalRoot}.era`,
    });
    await rename(this.path, newPath);

    return newPath;
  }

  async writeVersion(): Promise<void> {
    if (this.state.type === WriterStateType.FinishedGroup) {
      this.state = {
        type: WriterStateType.InitGroup,
        eraNumber: this.state.eraNumber + 1,
        currentOffset: this.state.currentOffset,
      };
    }
    if (this.state.type !== WriterStateType.InitGroup) {
      throw new Error("Writer has already been initialized");
    }
    await writeEntry(this.fh, this.state.currentOffset, EntryType.Version, new Uint8Array(0));
    // Move to writing blocks/state
    this.state = {
      type: WriterStateType.WriteGroup,
      eraNumber: this.state.eraNumber,
      currentOffset: this.state.currentOffset + E2STORE_HEADER_SIZE,
      blockOffsets: [],
      lastSlot: computeStartBlockSlotFromEraNumber(this.state.eraNumber) - 1,
    };
  }

  async writeCompressedState(slot: Slot, shortHistoricalRoot: string, data: Uint8Array): Promise<void> {
    if (this.state.type === WriterStateType.InitGroup) {
      await this.writeVersion();
    }
    if (this.state.type !== WriterStateType.WriteGroup) {
      throw new Error("unreachable");
    }
    const expectedSlot = this.state.eraNumber * SLOTS_PER_HISTORICAL_ROOT;
    if (!isValidEraStateSlot(slot, this.state.eraNumber)) {
      throw new Error(`State slot must be ${expectedSlot} for era ${this.eraNumber}, got ${slot}`);
    }
    for (let s = this.state.lastSlot + 1; s < slot; s++) {
      this.state.blockOffsets.push(0); // Empty slot
    }
    const stateOffset = this.state.currentOffset;
    await writeEntry(this.fh, this.state.currentOffset, EntryType.CompressedBeaconState, data);
    this.state.currentOffset += E2STORE_HEADER_SIZE + data.length;

    if (this.state.eraNumber !== 0) {
      const blocksIndex: SlotIndex = {
        type: EntryType.SlotIndex,
        startSlot: computeStartBlockSlotFromEraNumber(this.state.eraNumber),
        offsets: this.state.blockOffsets.map((o) => o - this.state.currentOffset),
        recordStart: this.state.currentOffset,
      };
      const blocksIndexPayload = serializeSlotIndex(blocksIndex);
      await writeEntry(this.fh, this.state.currentOffset, EntryType.SlotIndex, blocksIndexPayload);
      this.state.currentOffset += E2STORE_HEADER_SIZE + blocksIndexPayload.length;
    }
    const stateIndex: SlotIndex = {
      type: EntryType.SlotIndex,
      startSlot: slot,
      offsets: [stateOffset - this.state.currentOffset],
      recordStart: this.state.currentOffset,
    };
    const stateIndexPayload = serializeSlotIndex(stateIndex);
    await writeEntry(this.fh, this.state.currentOffset, EntryType.SlotIndex, stateIndexPayload);
    this.state.currentOffset += E2STORE_HEADER_SIZE + stateIndexPayload.length;

    this.state = {
      type: WriterStateType.FinishedGroup,
      eraNumber: this.state.eraNumber,
      currentOffset: this.state.currentOffset,
      shortHistoricalRoot,
    };
  }

  async writeSerializedState(slot: Slot, shortHistoricalRoot: string, data: Uint8Array): Promise<void> {
    const compressed = await snappyCompress(data);
    await this.writeCompressedState(slot, shortHistoricalRoot, compressed);
  }

  async writeState(state: BeaconState): Promise<void> {
    const slot = state.slot;
    const shortHistoricalRoot = getShortHistoricalRoot(this.config, state);
    const ssz = this.config.getForkTypes(slot).BeaconState.serialize(state);

    await this.writeSerializedState(slot, shortHistoricalRoot, ssz);
  }

  async writeCompressedBlock(slot: Slot, data: Uint8Array): Promise<void> {
    if (this.state.type === WriterStateType.InitGroup) {
      await this.writeVersion();
    }
    if (this.state.type !== WriterStateType.WriteGroup) {
      throw new Error("Cannot write blocks after writing canonical state");
    }
    if (this.eraNumber === 0) {
      throw new Error("Genesis era (era 0) does not contain blocks");
    }

    const blockEra = this.state.eraNumber;
    if (!isSlotInRange(slot, blockEra)) {
      throw new Error(`Slot ${slot} is not in valid block range for era ${blockEra}`);
    }
    if (slot <= this.state.lastSlot) {
      throw new Error(`Slots must be written in ascending order. Last slot: ${this.state.lastSlot}, got: ${slot}`);
    }
    for (let s = this.state.lastSlot + 1; s < slot; s++) {
      this.state.blockOffsets.push(0); // Empty slot
    }
    await writeEntry(this.fh, this.state.currentOffset, EntryType.CompressedSignedBeaconBlock, data);
    this.state.blockOffsets.push(this.state.currentOffset);
    this.state.currentOffset += E2STORE_HEADER_SIZE + data.length;
    this.state.lastSlot = slot;
  }

  async writeSerializedBlock(slot: Slot, data: Uint8Array): Promise<void> {
    const compressed = await snappyCompress(data);
    await this.writeCompressedBlock(slot, compressed);
  }

  async writeBlock(block: SignedBeaconBlock): Promise<void> {
    const slot = block.message.slot;
    const types = this.config.getForkTypes(slot);
    const ssz = types.SignedBeaconBlock.serialize(block);
    await this.writeSerializedBlock(slot, ssz);
  }
}
