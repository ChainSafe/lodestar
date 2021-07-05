import {phase0, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ssz, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "..";
import {AttesterSlashingError, AttesterSlashingErrorCode} from "../errors/attesterSlashingError";
import {IBeaconDb} from "../../db";
import {arrayIntersection, sszEqualPredicate} from "../../util/objects";

export async function validateGossipAttesterSlashing(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  attesterSlashing: phase0.AttesterSlashing
): Promise<void> {
  const attesterSlashedIndices = arrayIntersection<ValidatorIndex>(
    attesterSlashing.attestation1.attestingIndices.valueOf() as ValidatorIndex[],
    attesterSlashing.attestation2.attestingIndices.valueOf() as ValidatorIndex[],
    sszEqualPredicate(ssz.ValidatorIndex)
  );

  if (await db.attesterSlashing.hasAll(attesterSlashedIndices)) {
    throw new AttesterSlashingError({
      code: AttesterSlashingErrorCode.ALREADY_EXISTS,
    });
  }

  const state = chain.getHeadState();

  try {
    // verifySignature = false, verified in batch below
    allForks.assertValidAttesterSlashing(state, attesterSlashing, false);
  } catch (e) {
    throw new AttesterSlashingError({
      code: AttesterSlashingErrorCode.INVALID,
      error: e as Error,
    });
  }

  const signatureSets = allForks.getAttesterSlashingSignatureSets(state, attesterSlashing);
  if (!(await chain.bls.verifySignatureSets(signatureSets))) {
    throw new AttesterSlashingError({
      code: AttesterSlashingErrorCode.INVALID,
      error: Error("Invalid signature"),
    });
  }
}
