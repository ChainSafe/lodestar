import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {ForkName, isForkPostDeneb} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, Slot} from "@lodestar/types";
import {toHex, toHexString} from "@lodestar/utils";
import {toRootHex} from "@lodestar/utils/lib/bytes/browser.js";
import {kzgCommitmentToVersionedHash} from "../../../util/blobs.js";
import {ChainEventEmitter} from "../../emitter.js";
import {BlobsSource, BlockInput, BlockInputType, BlockSource as BlockSourceOld, NullBlockInput} from "../types.js";
import {BlockInputSource as BlockSource} from "./types.js";

export function isDaOutOfRange(
  config: ChainForkConfig,
  forkName: ForkName,
  blockSlot: Slot,
  currentEpoch: Epoch
): boolean {
  if (!isForkPostDeneb(forkName)) {
    return true;
  }
  return computeEpochAtSlot(blockSlot) < currentEpoch - config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS;
}

export function convertNewToOldBlockSource(source: BlockSource): BlockSourceOld {
  switch (source) {
    case BlockSource.api:
      return BlockSourceOld.api;
    case BlockSource.byRoot:
      return BlockSourceOld.byRoot;
    case BlockSource.byRange:
      return BlockSourceOld.byRange;
    default:
      return BlockSourceOld.gossip;
  }
}

export function convertNewToOldBlobSource(source: BlockSource): BlobsSource {
  switch (source) {
    case BlockSource.api:
      return BlobsSource.api;
    case BlockSource.byRoot:
      return BlobsSource.byRoot;
    case BlockSource.byRange:
      return BlobsSource.byRange;
    default:
      return BlobsSource.gossip;
  }
}

export function emitDataColumnSidecar(
  emitter: ChainEventEmitter,
  blockInput: BlockInput | NullBlockInput,
  blockRoot: Uint8Array
): void {
  if (blockInput.block === null) return;
  if (blockInput.type !== BlockInputType.availableData) return;
  if (emitter.listenerCount(routes.events.EventType.dataColumnSidecar) === 0) return;

  // TODO: Ideally it would be checked with ForkSeq > fulu but it's not returning right type
  if (blockInput.blockData.fork !== ForkName.fulu) return;

  const {dataColumns} = blockInput.blockData;
  for (const dataColumnSidecar of dataColumns) {
    const {index, kzgCommitments} = dataColumnSidecar;

    emitter.emit(routes.events.EventType.dataColumnSidecar, {
      blockRoot: toRootHex(blockRoot),
      slot: blockInput.block.message.slot,
      index,
      kzgCommitments: kzgCommitments.map(toHex),
      versionedHashes: kzgCommitments.map((commitment) => toHex(kzgCommitmentToVersionedHash(commitment))),
    });
  }
}
