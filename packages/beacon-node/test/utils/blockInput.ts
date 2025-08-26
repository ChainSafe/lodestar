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
  type: DAType;
  daOutOfRange: boolean;
  timeCreatedSec: number;
  forkName: ForkName;
  slot: number;
  blockRootHex: string;
  parentRootHex: string;
};

export class MockBlockInput implements IBlockInput {
  type: DAType;
  daOutOfRange: boolean;
  timeCreatedSec: number;
  forkName: ForkName;
  slot: number;
  blockRootHex: string;
  parentRootHex: string;

  _block?: SignedBeaconBlock;
  _blockSource?: BlockInputSource;
  _blockSeenTimestampSec?: number;
  _blockPeerIdStr?: string;

  _timeCompleted?: number;

  constructor({type, daOutOfRange, timeCreatedSec, forkName, slot, blockRootHex, parentRootHex}: MockBlockInputProps) {
    this.type = type;
    this.daOutOfRange = daOutOfRange;
    this.timeCreatedSec = timeCreatedSec;
    this.forkName = forkName;
    this.slot = slot;
    this.blockRootHex = blockRootHex;
    this.parentRootHex = parentRootHex;
  }

  addBlock(
    {block, blockRootHex, seenTimestampSec, source, peerIdStr}: AddBlock<ForkName>,
    _opts?: {throwOnDuplicateAdd: boolean}
  ): void {
    this.blockRootHex = blockRootHex;

    this._block = block;
    this._blockSeenTimestampSec = seenTimestampSec;
    this._blockSource = source;
    this._blockPeerIdStr = peerIdStr;
  }
  hasBlock(): boolean {
    return !this._block;
  }
  getBlock(): SignedBeaconBlock {
    // biome-ignore lint/style/noNonNullAssertion: test fixture
    return this._block!;
  }
  getBlockSource(): SourceMeta {
    return {
      seenTimestampSec: this._blockSeenTimestampSec ?? Date.now(),
      source: this._blockSource ?? BlockInputSource.gossip,
      peerIdStr: this._blockPeerIdStr ?? "0xTESTING_PEER_ID_STR",
    };
  }

  hasAllData(): boolean {
    return true;
  }
  hasBlockAndAllData(): boolean {
    return !!this._block;
  }

  getLogMeta(): LogMetaBasic {
    return {
      blockRoot: this.blockRootHex,
      slot: this.slot,
      timeCreatedSec: this.timeCreatedSec,
    };
  }

  getTimeComplete(): number {
    return this._timeCompleted ?? 0;
  }

  waitForAllData(_timeout: number, _signal?: AbortSignal): Promise<DAData> {
    return Promise.resolve(null);
  }
  waitForBlock(_timeout: number, _signal?: AbortSignal): Promise<SignedBeaconBlock> {
    return Promise.resolve(this._block as SignedBeaconBlock);
  }
  waitForBlockAndAllData(_timeout: number, _signal?: AbortSignal): Promise<this> {
    return Promise.resolve(this);
  }
}
