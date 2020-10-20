import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {IAttestationJob} from "../interface";
import {GENESIS_EPOCH} from "../../constants";
import {IBeaconClock} from "../clock";
import {AttestationError, AttestationErrorCode} from "../errors";

/**
 * Based on:
 * https://github.com/ethereum/eth2.0-specs/blob/v0.12.3/specs/phase0/fork-choice.md#validate_on_attestation
 */
export async function validateAttestation({
  config,
  forkChoice,
  clock,
  job,
}: {
  config: IBeaconConfig;
  forkChoice: IForkChoice;
  clock: IBeaconClock;
  job: IAttestationJob;
}): Promise<void> {
  const {attestation} = job;
  const target = attestation.data.target;
  const currentSlot = clock.currentSlot;
  const currentEpoch = clock.currentEpoch;
  const previousEpoch = currentEpoch > GENESIS_EPOCH ? currentEpoch - 1 : GENESIS_EPOCH;
  if (target.epoch !== computeEpochAtSlot(config, attestation.data.slot)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_BAD_TARGET_EPOCH,
      job,
    });
  }
  if (target.epoch < previousEpoch) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_PAST_EPOCH,
      attestationEpoch: target.epoch,
      currentEpoch,
      job,
    });
  }
  if (target.epoch > currentEpoch) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_FUTURE_EPOCH,
      attestationEpoch: target.epoch,
      currentEpoch,
      job,
    });
  }
  if (currentSlot - 1 < attestation.data.slot) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_FUTURE_SLOT,
      attestationSlot: attestation.data.slot,
      latestPermissibleSlot: currentSlot - 1,
      job,
    });
  }
  if (!forkChoice.hasBlock(target.root)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_UNKNOWN_TARGET_ROOT,
      root: target.root.valueOf() as Uint8Array,
      job,
    });
  }
  if (!forkChoice.hasBlock(attestation.data.beaconBlockRoot)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_UNKNOWN_BEACON_BLOCK_ROOT,
      beaconBlockRoot: attestation.data.beaconBlockRoot.valueOf() as Uint8Array,
      job,
    });
  }
  if (!forkChoice.isDescendant(target.root, attestation.data.beaconBlockRoot)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_HEAD_NOT_TARGET_DESCENDANT,
      job,
    });
  }
}
