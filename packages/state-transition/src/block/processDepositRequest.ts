import {ForkSeq, UNSET_DEPOSIT_REQUESTS_START_INDEX} from "@lodestar/params";
import {electra, ssz} from "@lodestar/types";
import {toPubkeyHex, toRootHex} from "@lodestar/utils";
import {CachedBeaconStateElectra, CachedBeaconStateGloas} from "../types.js";
import {isBuilderWithdrawalCredential} from "../util/gloas.js";
import {isValidatorKnown} from "../util/index.js";
import {BatchOnboardBuilder} from "../util/onboardBuilder.js";
import {PendingDepositsLookup} from "../util/pendingDepositsLookup.js";

// TODO GLOAS: the PendingDepositsLookup is currently scoped to a single envelope of
// deposit-requests. We can track it as ephemeral within EpochCache and transfer to the next block
// transition to reuse cached signature verifications.
// See https://github.com/ChainSafe/lodestar/issues/9181
export function processDepositRequest(
  fork: ForkSeq,
  state: CachedBeaconStateElectra | CachedBeaconStateGloas,
  depositRequest: electra.DepositRequest,
  pendingDepositsLookup?: PendingDepositsLookup,
  batcher?: BatchOnboardBuilder
): void {
  const {pubkey, withdrawalCredentials, amount, signature} = depositRequest;

  if (fork >= ForkSeq.gloas) {
    const stateGloas = state as CachedBeaconStateGloas;
    const lookup = pendingDepositsLookup ?? PendingDepositsLookup.build(stateGloas);
    const ownsBatcher = batcher === undefined;
    const onboarder = batcher ?? new BatchOnboardBuilder(stateGloas);
    const pubkeyHex = toPubkeyHex(pubkey);
    const validatorIndex = state.epochCtx.getValidatorIndex(pubkey);
    const isValidator = isValidatorKnown(state, validatorIndex);

    // after this, it is either an applied builder (-> top-up below) or absent (its
    // queued deposit had an invalid signature -> re-evaluated as a fresh candidate).
    // this ensures the function works the same way as the spec
    onboarder.onboardBuildersIfQueued(pubkeyHex);

    const builderIndex = onboarder.getAppliedBuilderIndex(pubkeyHex);

    if (builderIndex !== null) {
      // Top up an existing builder regardless of withdrawal credential prefix
      onboarder.topupBuilder(builderIndex, amount);
      return;
    }

    // Only check the (expensive) "pending validator" condition when needed
    if (
      isBuilderWithdrawalCredential(withdrawalCredentials) &&
      !isValidator &&
      !lookup.hasPendingValidator(state.config, pubkeyHex)
    ) {
      const pendingDeposit = {pubkey, withdrawalCredentials, amount, signature, slot: state.slot};
      const payloadBlockHash = toRootHex(stateGloas.latestExecutionPayloadBid.blockHash);
      if (stateGloas.epochCtx.builderDepositSignatureCache.isVerifiedByPayload(payloadBlockHash, pendingDeposit)) {
        onboarder.onboardBuilderVerifiedSignature(pendingDeposit);
        return;
      }
      onboarder.queueBuilderDeposit(pubkeyHex, pendingDeposit);
      // this is for the spec test where we want to eagerly onboard builder immediately
      if (ownsBatcher) onboarder.onboardQueuedBuilders();
      return;
    }

    const pendingDeposit = ssz.electra.PendingDeposit.toViewDU({
      pubkey,
      withdrawalCredentials,
      amount,
      signature,
      slot: state.slot,
    });
    // Keep the lookup in sync with state.pendingDeposits so later deposit-requests
    // in the same envelope see this deposit
    lookup.add(pendingDeposit, pubkeyHex);
    state.pendingDeposits.push(pendingDeposit);
    return;
  }

  // Pre-Gloas (Electra) path
  if (state.depositRequestsStartIndex === UNSET_DEPOSIT_REQUESTS_START_INDEX) {
    state.depositRequestsStartIndex = depositRequest.index;
  }

  // Add validator deposits to the queue
  const pendingDeposit = ssz.electra.PendingDeposit.toViewDU({
    pubkey,
    withdrawalCredentials,
    amount,
    signature,
    slot: state.slot,
  });
  state.pendingDeposits.push(pendingDeposit);
}
