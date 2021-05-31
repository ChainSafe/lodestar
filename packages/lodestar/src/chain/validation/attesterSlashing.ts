import {isValidAttesterSlashing, allForks} from "@chainsafe/lodestar-beacon-state-transition/";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "..";
import {AttesterSlashingError, AttesterSlashingErrorCode} from "../errors/attesterSlashingError";
import {IBeaconDb} from "../../db";
import {arrayIntersection, sszEqualPredicate} from "../../util/objects";
import {GossipAction} from "../errors";

export async function validateGossipAttesterSlashing(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  attesterSlashing: phase0.AttesterSlashing
): Promise<void> {
  // [IGNORE] At least one index in the intersection of the attesting indices of each attestation
  // has not yet beenseen in any prior attester_slashing
  // -- i.e. attester_slashed_indices = set(attestation_1.attesting_indices).intersection(attestation_2.attesting_indices),
  // verify if any(attester_slashed_indices.difference(prior_seen_attester_slashed_indices))).
  const attesterSlashedIndices = arrayIntersection<ValidatorIndex>(
    attesterSlashing.attestation1.attestingIndices.valueOf() as ValidatorIndex[],
    attesterSlashing.attestation2.attestingIndices.valueOf() as ValidatorIndex[],
    sszEqualPredicate(config.types.ValidatorIndex)
  );
  if (await db.attesterSlashing.hasAll(attesterSlashedIndices)) {
    throw new AttesterSlashingError(GossipAction.IGNORE, {
      code: AttesterSlashingErrorCode.SLASHING_ALREADY_EXISTS,
    });
  }

  const state = chain.getHeadState();

  // [REJECT] All of the conditions within process_attester_slashing pass validation.
  // verifySignature = false, verified in batch below
  if (!isValidAttesterSlashing(config, state, attesterSlashing, false)) {
    throw new AttesterSlashingError(GossipAction.REJECT, {
      code: AttesterSlashingErrorCode.INVALID_SLASHING,
    });
  }

  const signatureSets = allForks.getAttesterSlashingSignatureSets(state, attesterSlashing);
  if (!(await chain.bls.verifySignatureSets(signatureSets))) {
    throw new AttesterSlashingError(GossipAction.REJECT, {
      code: AttesterSlashingErrorCode.INVALID_SLASHING,
    });
  }
}
