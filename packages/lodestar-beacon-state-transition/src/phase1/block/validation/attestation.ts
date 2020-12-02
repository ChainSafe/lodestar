import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Phase1} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {getCurrentEpoch, getPreviousEpoch, computeEpochAtSlot} from "../../../util/epoch";
import {getCommitteeCountPerSlot} from "../../state/accessors";
import {getBeaconCommittee, isValidIndexedAttestation, getIndexedAttestation} from "../../../util";
import {isOnTimeAttestation} from "../../state/predicates";
import {getBlockRootAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {computeShardFromCommitteeIndex} from "../../misc";
import {GENESIS_SLOT} from "../../../constants";
import {computePreviousSlot} from "../../misc/slot";

export function validateAttestation(
  config: IBeaconConfig,
  state: Phase1.BeaconState,
  attestation: Phase1.Attestation
): void {
  const data = attestation.data;
  const currentEpoch = getCurrentEpoch(config, state);
  const previousEpoch = getPreviousEpoch(config, state);
  assert.lt(data.index, getCommitteeCountPerSlot(config, state, data.slot), "Attestation index out of bounds");
  assert.true(
    data.target.epoch === previousEpoch || data.target.epoch === currentEpoch,
    `Attestation is targeting too old epoch ${data.target.epoch}, current=${currentEpoch}`
  );
  assert.equal(data.target.epoch, computeEpochAtSlot(config, data.slot), "Attestation is not targeting current epoch");
  assert.true(
    data.slot + config.params.MIN_ATTESTATION_INCLUSION_DELAY <= state.slot &&
      state.slot <= data.slot + config.params.SLOTS_PER_EPOCH,
    "Attestation slot not withing attestation inclusion windows"
  );
  const committee = getBeaconCommittee(config, state, data.slot, data.index);
  assert.equal(attestation.aggregationBits.length, committee.length);
  if (data.target.epoch == currentEpoch) {
    assert.true(config.types.Checkpoint.equals(data.source, state.currentJustifiedCheckpoint));
  } else {
    assert.true(config.types.Checkpoint.equals(data.source, state.previousJustifiedCheckpoint));
  }
  if (isOnTimeAttestation(state, data)) {
    assert.true(config.types.Root.equals(data.beaconBlockRoot, getBlockRootAtSlot(config, state, data.slot)));
    const shard = computeShardFromCommitteeIndex(config, state, data.index, data.slot);
    assert.equal(data.shard, shard);
    if (data.slot > GENESIS_SLOT) {
      //On-time attestations should have a non-empty shard transition root
      assert.true(
        !config.types.Root.equals(
          data.shardTransitionRoot,
          config.types.phase1.ShardTransition.hashTreeRoot(config.types.phase1.ShardTransition.defaultValue())
        )
      );
    } else {
      assert.true(
        config.types.Root.equals(
          data.shardTransitionRoot,
          config.types.phase1.ShardTransition.hashTreeRoot(config.types.phase1.ShardTransition.defaultValue())
        )
      );
    }
  } else {
    assert.lt(data.slot, computePreviousSlot(state.slot));
    assert.equal(data.shardTransitionRoot, config.types.Root.defaultValue());
  }
  assert.true(isValidIndexedAttestation(config, state, getIndexedAttestation(config, state, attestation)));
}
