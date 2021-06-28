import {altair} from "@chainsafe/lodestar-types";
import {isZeroHash, sumBits} from "../utils/utils";

/**
 * Returns the update with more bits. On ties, newUpdate is the better
 */
export function isBetterUpdate(prevUpdate: altair.LightClientUpdate, newUpdate: altair.LightClientUpdate): boolean {
  const prevIsFinalized = isFinalizedUpdate(prevUpdate);
  const newIsFinalized = isFinalizedUpdate(newUpdate);

  // newUpdate becomes finalized, it's better
  if (newIsFinalized && !prevIsFinalized) return true;
  // newUpdate is no longer finalized, it's worse
  if (!newIsFinalized && prevIsFinalized) return false;
  // For two finalized, or two non-finalized: compare bit count
  return sumBits(newUpdate.syncCommitteeBits) >= sumBits(prevUpdate.syncCommitteeBits);
}

export function isLatestBestFinalizedUpdate(
  prevUpdate: altair.LightClientUpdate,
  newUpdate: altair.LightClientUpdate
): boolean {
  if (newUpdate.finalityHeader.slot > prevUpdate.finalityHeader.slot) return true;
  if (newUpdate.finalityHeader.slot < prevUpdate.finalityHeader.slot) return false;
  return sumBits(newUpdate.syncCommitteeBits) >= sumBits(prevUpdate.syncCommitteeBits);
}

export function isLatestBestNonFinalizedUpdate(
  prevUpdate: altair.LightClientUpdate,
  newUpdate: altair.LightClientUpdate
): boolean {
  if (newUpdate.header.slot > prevUpdate.header.slot) return true;
  if (newUpdate.header.slot < prevUpdate.header.slot) return false;
  return sumBits(newUpdate.syncCommitteeBits) >= sumBits(prevUpdate.syncCommitteeBits);
}

export function isFinalizedUpdate(update: altair.LightClientUpdate): boolean {
  return !isZeroHash(update.finalityHeader.stateRoot);
}
