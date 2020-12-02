import {ValidatorIndex, Phase1, Epoch, Number64} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {packCompactValidator} from ".";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

/**
 * Given a state and a list of validator indices, outputs the ``CompactCommittee`` representing them.
 */
export function committeeToComactCommittee(
  config: IBeaconConfig,
  state: Phase1.BeaconState,
  committee: List<ValidatorIndex>
): Phase1.CompactCommittee {
  return Array.from(committee).reduce((compactCommittee, index) => {
    const validator = state.validators[index];
    compactCommittee.pubkeys.push(validator.pubkey);
    compactCommittee.compactValidators.push(
      packCompactValidator(
        index,
        validator.slashed,
        validator.effectiveBalance / config.params.EFFECTIVE_BALANCE_INCREMENT
      )
    );
    return compactCommittee;
  }, config.types.phase1.CompactCommittee.defaultValue());
}

/**
 * Return the source epoch for computing the committee.
 */
export function computeCommitteeSourceEpoch(epoch: Epoch, period: Number64): Epoch {
  let sourceEpoch = epoch - (epoch % period);
  if (sourceEpoch >= period) {
    sourceEpoch -= period;
  }
  return sourceEpoch;
}
