import {GENESIS_SLOT} from "@chainsafe/lodestar-beacon-state-transition";
import {MAX_REQUEST_BLOCKS, phase0, Slot} from "@chainsafe/lodestar-types";
import {IBlockFilterOptions} from "../../../db/api/beacon/repositories";
import {IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db";
import {RpcResponseStatus} from "../../../constants";
import {ResponseError} from "../response";
import {IArchivingStatus, ITaskService} from "../../../tasks/interface";
import {checkLinearChainSegment} from "../../../../src/util/chain";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

/**
 * Need to retry again if BlockArchiver is running at an overlapsed range.
 */
export async function onBeaconBlocksByRange(
  config: IBeaconConfig,
  requestBody: phase0.BeaconBlocksByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb,
  chores?: ITaskService
): Promise<phase0.SignedBeaconBlock[]> {
  if (!chores) throw new ResponseError(RpcResponseStatus.SERVER_ERROR, "node is not fully started");
  if (requestBody.step < 1) {
    throw new ResponseError(RpcResponseStatus.INVALID_REQUEST, "step < 1");
  }
  if (requestBody.count < 1) {
    throw new ResponseError(RpcResponseStatus.INVALID_REQUEST, "count < 1");
  }
  if (requestBody.startSlot < GENESIS_SLOT) {
    throw new ResponseError(RpcResponseStatus.INVALID_REQUEST, "startSlot < genesis");
  }

  if (requestBody.count > MAX_REQUEST_BLOCKS) {
    requestBody.count = MAX_REQUEST_BLOCKS;
  }
  const archiveStatus = chores.getBlockArchivingStatus();
  let blocks: phase0.SignedBeaconBlock[];
  // BlockArchiver is running with a ranges overlapped requestBody
  if (shouldWaitForBlockArchiver(requestBody, archiveStatus)) {
    // BLockArchiver finishes its run
    await chores.waitForBlockArchiver();
    blocks = await handleBeaconBlocksByRange(requestBody, chain, db);
  } else {
    blocks = await handleBeaconBlocksByRange(requestBody, chain, db);
    const newArchiveStatus = chores.getBlockArchivingStatus();
    // BlockArchiver is running with an overlappsed range
    if (shouldWaitForBlockArchiver(requestBody, archiveStatus, newArchiveStatus)) {
      await chores.waitForBlockArchiver();
      blocks = await handleBeaconBlocksByRange(requestBody, chain, db);
    } else if (shouldRetry(requestBody, archiveStatus, newArchiveStatus)) {
      // BlockArchiver finishes its run during handleBeaconBlocksByRange
      blocks = await handleBeaconBlocksByRange(requestBody, chain, db);
    }
  }
  // before we return, make sure client can process our response, otherwise they'll downvote us
  if (requestBody.step === 1 && blocks.length > 1) {
    try {
      checkLinearChainSegment(config, blocks);
    } catch (e) {
      throw new ResponseError(RpcResponseStatus.SERVER_ERROR, (e as Error).message);
    }
  }
  return blocks;
}

/**
 * If no newArchiveStatus, return true if archiveStatus is running with an overlapping range.
 * Else
 *      + if same IArchivingStatus, return false
 *      + else if different IArchivingStatus and newArchiveStatus is running with an overlapping range, return true
 *      + else return false
 */
export function shouldWaitForBlockArchiver(
  requestBody: phase0.BeaconBlocksByRangeRequest,
  archiveStatus: IArchivingStatus,
  newArchiveStatus?: IArchivingStatus
): boolean {
  // 1st check
  if (!newArchiveStatus) {
    return (
      archiveStatus.finalizingSlot !== null &&
      isOverlappedRange(requestBody, archiveStatus.lastFinalizedSlot, archiveStatus.finalizingSlot)
    );
  } else {
    // 2nd check
    if (isSameArchiveStatus(archiveStatus, newArchiveStatus)) {
      return false;
    } else {
      return (
        newArchiveStatus.finalizingSlot !== null &&
        // BlockArchiver may run at the same time with an overlappsed range
        isOverlappedRange(requestBody, newArchiveStatus.lastFinalizedSlot, newArchiveStatus.finalizingSlot)
      );
    }
  }
}

/**
 * if different IArchivingStatus and newArchiveStatus is complete with an overlapping range, return true
 * if different IArchivingStatus and newArchiveStatus is complete without an overllaping range, return false
 */
export function shouldRetry(
  requestBody: phase0.BeaconBlocksByRangeRequest,
  archiveStatus: IArchivingStatus,
  newArchiveStatus: IArchivingStatus
): boolean {
  return (
    !isSameArchiveStatus(archiveStatus, newArchiveStatus) &&
    newArchiveStatus.finalizingSlot == null &&
    isOverlappedRange(requestBody, archiveStatus.lastFinalizedSlot, newArchiveStatus.lastFinalizedSlot)
  );
}

export function isSameArchiveStatus(archiveStatus: IArchivingStatus, newArchiveStatus: IArchivingStatus): boolean {
  return (
    archiveStatus.lastFinalizedSlot === newArchiveStatus.lastFinalizedSlot &&
    archiveStatus.finalizingSlot === newArchiveStatus.finalizingSlot
  );
}

/**
 * Start and end are inclusive.
 * @param requestBody
 * @param start
 * @param end
 */
export function isOverlappedRange(requestBody: phase0.BeaconBlocksByRangeRequest, start: Slot, end: Slot): boolean {
  const requestStart = requestBody.startSlot;
  const requestEnd = requestBody.startSlot + requestBody.count * requestBody.step;

  return (start >= requestStart && start < requestEnd) || (end >= requestStart && end < requestEnd);
}

export async function handleBeaconBlocksByRange(
  requestBody: phase0.BeaconBlocksByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): Promise<phase0.SignedBeaconBlock[]> {
  const archivedBlocks = await db.blockArchive.values({
    gte: requestBody.startSlot,
    lt: requestBody.startSlot + requestBody.count * requestBody.step,
    step: requestBody.step,
  } as IBlockFilterOptions);
  return await injectRecentBlocks(archivedBlocks, chain, requestBody);
}

async function injectRecentBlocks(
  archiveBlocks: phase0.SignedBeaconBlock[] = [],
  chain: IBeaconChain,
  request: phase0.BeaconBlocksByRangeRequest
): Promise<phase0.SignedBeaconBlock[]> {
  let slot = archiveBlocks.length > 0 ? archiveBlocks[archiveBlocks.length - 1].message.slot : -1;
  slot = slot === -1 ? request.startSlot : slot + request.step;
  const upperSlot = request.startSlot + request.count * request.step;
  const slots = [] as number[];
  while (slot < upperSlot) {
    slots.push(slot);
    slot += request.step;
  }

  const blocks = (await chain.getUnfinalizedBlocksAtSlots(slots)) || [];
  return [...archiveBlocks, ...blocks];
}
