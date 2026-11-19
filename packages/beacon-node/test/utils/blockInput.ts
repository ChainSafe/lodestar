import {ForkName} from "@lodestar/params";
import {SignedBeaconBlock} from "@lodestar/types";
import {
  AddBlock,
  BlockInputSource,
  DAData,
  DAType,
  IBlockInput,
  LogMetaBasic,
  SourceMeta,
} from "../../src/chain/blocks/blockInput/index.js";

export type MockBlockInputProps = {
  type?: DAType;
  daOutOfRange?: boolean;
  timeCreatedSec?: number;
  forkName?: ForkName;
  slot?: number;
  blockRootHex?: string;
  parentRootHex?: string | null;
};

export class MockBlockInput implements IBlockInput {
  type: DAType;
  daOutOfRange: boolean;
  timeCreatedSec: number;
  forkName: ForkName;
  slot: number;
  blockRootHex: string;
  parentRootHex: string;

  block?: SignedBeaconBlock;
  blockSource?: BlockInputSource;
  blockSeenTimestampSec?: number;
  blockPeerIdStr?: string;

  timeCompleted?: number;

  constructor({type, daOutOfRange, timeCreatedSec, forkName, slot, blockRootHex, parentRootHex}: MockBlockInputProps) {
    this.type = type ?? DAType.PreData;
    this.daOutOfRange = daOutOfRange ?? true;
    this.timeCreatedSec = timeCreatedSec ?? 0;
    this.forkName = forkName ?? ForkName.capella;
    this.slot = slot ?? 0;
    this.blockRootHex = blockRootHex ?? "0x0000000000000000000000000000000000000000000000000000000000000000";
    this.parentRootHex = parentRootHex ?? "0x0000000000000000000000000000000000000000000000000000000000000000";
  }

  addBlock(
    {block, blockRootHex, seenTimestampSec, source, peerIdStr}: AddBlock<ForkName>,
    _opts?: {throwOnDuplicateAdd: boolean}
  ): void {
    this.blockRootHex = blockRootHex;

    this.block = block;
    this.blockSeenTimestampSec = seenTimestampSec;
    this.blockSource = source;
    this.blockPeerIdStr = peerIdStr;
  }
  hasBlock(): boolean {
    return !this.block;
  }
  getBlock(): SignedBeaconBlock {
    // biome-ignore lint/style/noNonNullAssertion: test fixture
    return this.block!;
  }
  getBlockSource(): SourceMeta {
    return {
      seenTimestampSec: this.blockSeenTimestampSec ?? Date.now(),
      source: this.blockSource ?? BlockInputSource.gossip,
      peerIdStr: this.blockPeerIdStr ?? "0xTESTING_PEER_ID_STR",
    };
  }

  hasAllData(): boolean {
    return true;
  }
  hasBlockAndAllData(): boolean {
    return !!this.block;
  }

  getLogMeta(): LogMetaBasic {
    return {
      blockRoot: this.blockRootHex,
      slot: this.slot,
      timeCreatedSec: this.timeCreatedSec,
    };
  }

  getTimeComplete(): number {
    return this.timeCompleted ?? 0;
  }

  getSerializedCacheKeys(): object[] {
    return this.block ? [this.block] : [];
  }

  waitForAllData(_timeout: number, _signal?: AbortSignal): Promise<DAData> {
    return Promise.resolve(null);
  }
  waitForBlock(_timeout: number, _signal?: AbortSignal): Promise<SignedBeaconBlock> {
    return Promise.resolve(this.block as SignedBeaconBlock);
  }
  waitForBlockAndAllData(_timeout: number, _signal?: AbortSignal): Promise<this> {
    return Promise.resolve(this);
  }
}
