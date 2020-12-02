import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Phase1, BLSPubkey} from "@chainsafe/lodestar-types";
import {getLightClientCommittee} from "../state";
import {getCurrentEpoch, getBlockRootAtSlot} from "../..";
import {computePreviousSlot} from "../misc";
import {increaseBalance} from "../../util/balance";
import {getBaseReward} from "../../epoch/balanceUpdates/util";
import {getBeaconProposerIndex, computeSigningRoot, getDomain} from "../../util";
import {computeEpochAtSlot} from "../../util/epoch";
import {assert} from "@chainsafe/lodestar-utils";
import {optionalFastAggregateVerify} from "../state/predicates";

export function processLightClientAggregate(
  config: IBeaconConfig,
  state: Phase1.BeaconState,
  blockBody: Phase1.BeaconBlockBody
): void {
  const committee = getLightClientCommittee(config, state, getCurrentEpoch(config, state));
  const previousSlot = computePreviousSlot(state.slot);
  const previousBlockRoot = getBlockRootAtSlot(config, state, previousSlot);
  let totalReward = BigInt(0);
  const signerPubkeys: BLSPubkey[] = [];
  committee.forEach((participantIndex, bitIntex) => {
    if (blockBody.lightClientBits[bitIntex]) {
      const validator = state.validators[participantIndex];
      signerPubkeys.push(validator.pubkey);
      if (!validator.slashed) {
        const reward = getBaseReward(config, state, participantIndex);
        increaseBalance(state, participantIndex, reward);
        totalReward += reward;
      }
    }
  });
  increaseBalance(
    state,
    getBeaconProposerIndex(config, state),
    totalReward / BigInt(config.params.PROPOSER_REWARD_QUOTIENT)
  );
  const signingRoot = computeSigningRoot(
    config,
    config.types.Root,
    previousBlockRoot,
    getDomain(config, state, config.params.phase1.DOMAIN_LIGHT_CLIENT, computeEpochAtSlot(config, previousSlot))
  );
  assert.true(
    optionalFastAggregateVerify(config, signerPubkeys, signingRoot, blockBody.lightClientSignature),
    "Light client aggregate signature verification failed"
  );
}
