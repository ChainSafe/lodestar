import {hash} from "@chainsafe/ssz";
import {BLSSignature} from "@chainsafe/lodestar-types";
import {intDiv, bytesToBigInt} from "@chainsafe/lodestar-utils";
import {
  TARGET_AGGREGATORS_PER_COMMITTEE,
  SYNC_COMMITTEE_SIZE,
  SYNC_COMMITTEE_SUBNET_COUNT,
  TARGET_AGGREGATORS_PER_SYNC_SUBCOMMITTEE,
} from "@chainsafe/lodestar-params";

const ZERO_BIGINT = BigInt(0);

export function isSyncCommitteeAggregator(selectionProof: BLSSignature): boolean {
  const modulo = Math.max(
    1,
    intDiv(intDiv(SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT), TARGET_AGGREGATORS_PER_SYNC_SUBCOMMITTEE)
  );
  return isSelectionProofValid(selectionProof, modulo);
}

export function isAggregatorFromCommitteeLength(committeeLength: number, slotSignature: BLSSignature): boolean {
  const modulo = Math.max(1, intDiv(committeeLength, TARGET_AGGREGATORS_PER_COMMITTEE));
  return isSelectionProofValid(slotSignature, modulo);
}

/**
 * Note: **must** use bytesToBigInt() otherwise a JS number is not able to represent the latest digits of
 * the remainder, resulting in `14333559117764833000` for example, where the last three digits are always zero.
 * Using bytesToInt() may cause isSelectionProofValid() to always return false.
 */
export function isSelectionProofValid(sig: BLSSignature, modulo: number): boolean {
  return bytesToBigInt(hash(sig.valueOf() as Uint8Array).slice(0, 8)) % BigInt(modulo) === ZERO_BIGINT;
}
