/**
 * @module chain/stateTransition/util
 */

import {
  AttestationData,
  Epoch,
} from "../../../types";

import {slotToEpoch} from "./epoch";


/**
 * Check if ``attestationData1`` and ``attestationData2`` have the same target.
 */
export function isDoubleVote(attestationData1: AttestationData, attestationData2: AttestationData): boolean {
  const targetEpoch1: Epoch = slotToEpoch(attestationData1.slot);
  const targetEpoch2: Epoch = slotToEpoch(attestationData2.slot);
  return targetEpoch1 === targetEpoch2;
}

/**
 * Check if ``attestationData1`` surrounds ``attestationData2``
 */
export function isSurroundVote(attestationData1: AttestationData, attestationData2: AttestationData): boolean {
  const sourceEpoch1: Epoch  = attestationData1.sourceEpoch;
  const sourceEpoch2: Epoch  = attestationData2.sourceEpoch;
  const targetEpoch1: Epoch  = slotToEpoch(attestationData1.slot);
  const targetEpoch2: Epoch  = slotToEpoch(attestationData2.slot);
  return (
    sourceEpoch1 < sourceEpoch2 &&
    targetEpoch2 < targetEpoch1
  );
}
