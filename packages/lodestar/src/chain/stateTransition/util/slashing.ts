/**
 * @module chain/stateTransition/util
 */

import {equals, serialize} from "@chainsafe/ssz";

import {AttestationData} from "@chainsafe/eth2-types";
import {IBeaconConfig} from "../../../config";

/**
 * Check if data1 and data2 are slashable according to Casper FFG rules.
 */
export function isSlashableAttestationData(
  config: IBeaconConfig,
  data1: AttestationData,
  data2: AttestationData
): boolean {
  return (
    // Double vote
    (!equals(data1, data2, config.types.AttestationData)
      && data1.targetEpoch === data2.targetEpoch) ||
    // Surround vote
    (data1.sourceEpoch < data2.sourceEpoch &&
      data2.targetEpoch < data1.targetEpoch)
  );
}
