import {PublicKey, Signature} from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BLSPubkey, BLSSignature, Bytes32, CommitteeIndex, Phase1, Root} from "@chainsafe/lodestar-types";
import {EMPTY_SIGNATURE} from "../..";
import {computePreviousSlot} from "../misc/slot";

/**
 * Check if the given ``attestation_data`` is on-time.
 */
export function isOnTimeAttestation(state: Phase1.BeaconState, attestationData: Phase1.AttestationData): boolean {
  return attestationData.slot == computePreviousSlot(state.slot);
}

/**
 *  Check if on-time ``attestation`` helped contribute to the successful crosslink of
 *  ``winning_root`` formed by ``committee_index`` committee.
 */
export function isWinningAttestation(
  config: IBeaconConfig,
  state: Phase1.BeaconState,
  attestation: Phase1.PendingAttestation,
  committeeIndex: CommitteeIndex,
  winningRoot: Root
): boolean {
  return (
    isOnTimeAttestation(state, attestation.data) &&
    config.types.CommitteeIndex.equals(attestation.data.index, committeeIndex) &&
    config.types.Root.equals(attestation.data.shardTransitionRoot, winningRoot)
  );
}

/**
 *     If ``pubkeys`` is an empty list, the given ``signature`` should be a stub ``NO_SIGNATURE``.
 *  Otherwise, verify it with standard BLS AggregateVerify API.
 */
export function optionalAggregateVerify(
  config: IBeaconConfig,
  pubkeys: BLSPubkey[],
  messages: Bytes32[],
  signature: BLSSignature
): boolean {
  if (pubkeys.length === 0) {
    return config.types.BLSSignature.equals(signature, EMPTY_SIGNATURE);
  } else {
    return Signature.fromBytes(signature.valueOf() as Uint8Array).verifyMultiple(
      pubkeys.map((pk) => PublicKey.fromBytes(pk.valueOf() as Uint8Array)),
      messages.map((m) => m.valueOf() as Uint8Array)
    );
  }
}

/**
 *     If ``pubkeys`` is an empty list, the given ``signature`` should be a stub ``NO_SIGNATURE``.
 *  Otherwise, verify it with standard BLS AggregateVerify API.
 */
export function optionalFastAggregateVerify(
  config: IBeaconConfig,
  pubkeys: BLSPubkey[],
  message: Bytes32,
  signature: BLSSignature
): boolean {
  if (pubkeys.length === 0) {
    return config.types.BLSSignature.equals(signature, EMPTY_SIGNATURE);
  } else {
    return Signature.fromBytes(signature.valueOf() as Uint8Array).verifyAggregate(
      pubkeys.map((pk) => PublicKey.fromBytes(pk.valueOf() as Uint8Array)),
      message.valueOf() as Uint8Array
    );
  }
}
