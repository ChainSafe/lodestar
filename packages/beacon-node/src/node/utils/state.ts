import {ChainForkConfig} from "@lodestar/config";
import {
  BUILDER_INDEX_SELF_BUILD,
  EPOCHS_PER_HISTORICAL_VECTOR,
  FAR_FUTURE_EPOCH,
  GENESIS_EPOCH,
  MAX_EFFECTIVE_BALANCE,
  SLOTS_PER_HISTORICAL_ROOT,
} from "@lodestar/params";
import {
  BeaconStateAllForks,
  BeaconStatePq,
  CachedBeaconStateElectra,
  CachedBeaconStateFulu,
  createCachedBeaconState,
  createEmptyEpochCacheImmutableData,
  initializeProposerLookahead,
  initializePtcWindow,
} from "@lodestar/state-transition";
import {Bytes32, pq, ssz} from "@lodestar/types";
import {interopDeposits} from "./interop/deposits.js";
import {InteropStateOpts, getInteropState} from "./interop/state.js";

/**
 * Builds state for `dev` command, for sim testing and some other tests
 */
export function initDevState(
  config: ChainForkConfig,
  validatorCount: number,
  interopStateOpts: InteropStateOpts
): BeaconStateAllForks {
  const deposits = interopDeposits(
    config,
    ssz.phase0.DepositDataRootList.defaultViewDU(),
    validatorCount,
    interopStateOpts
  );
  return getInteropState(config, interopStateOpts, deposits);
}

export type PqGenesisValidator = {pubkey: pq.XMSSPubkey; vrfRoot: Bytes32};

/**
 * Builds the state of a `dev` chain that starts at the pq fork. There is no deposit contract to
 * read validators from, so they are written into the registry, all active, as the spec's test
 * genesis does.
 */
export function initDevStatePq(
  config: ChainForkConfig,
  validators: PqGenesisValidator[],
  {genesisTime, eth1BlockHash}: {genesisTime: number; eth1BlockHash: Bytes32}
): BeaconStatePq {
  const state = ssz.pq.BeaconState.defaultViewDU();
  state.genesisTime = genesisTime;
  state.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: config.GLOAS_FORK_VERSION,
    currentVersion: config.PQ_FORK_VERSION,
    epoch: GENESIS_EPOCH,
  });
  state.randaoMixes = ssz.phase0.RandaoMixes.toViewDU(
    Array.from({length: EPOCHS_PER_HISTORICAL_VECTOR}, () => eth1BlockHash)
  );
  state.eth1Data = ssz.phase0.Eth1Data.toViewDU({
    depositRoot: new Uint8Array(32),
    depositCount: BigInt(validators.length),
    blockHash: eth1BlockHash,
  });
  state.eth1DepositIndex = validators.length;
  state.depositRequestsStartIndex = BigInt(validators.length);

  const withdrawalCredentials = new Uint8Array(32);
  withdrawalCredentials[0] = 0x01;
  for (const {pubkey, vrfRoot} of validators) {
    state.validators.push(
      ssz.pq.Validator.toViewDU({
        pubkey,
        vrfRoot,
        withdrawalCredentials,
        effectiveBalance: MAX_EFFECTIVE_BALANCE,
        slashed: false,
        activationEligibilityEpoch: GENESIS_EPOCH,
        activationEpoch: GENESIS_EPOCH,
        exitEpoch: FAR_FUTURE_EPOCH,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      })
    );
    state.balances.push(MAX_EFFECTIVE_BALANCE);
    state.previousEpochParticipation.push(0);
    state.currentEpochParticipation.push(0);
    state.inactivityScores.push(0);
  }
  state.genesisValidatorsRoot = state.validators.hashTreeRoot();

  // The genesis bid has the empty block hash: the chain starts with no payload of its own
  state.latestBlockHash = eth1BlockHash;
  const bid = {
    ...ssz.pq.ExecutionPayloadBid.defaultValue(),
    parentBlockHash: eth1BlockHash,
    builderIndex: BUILDER_INDEX_SELF_BUILD,
    executionRequestsRoot: ssz.pq.ExecutionRequests.hashTreeRoot(ssz.pq.ExecutionRequests.defaultValue()),
  };
  state.latestExecutionPayloadBid = ssz.pq.ExecutionPayloadBid.toViewDU(bid);
  const body = ssz.pq.BeaconBlockBody.defaultValue();
  body.signedExecutionPayloadBid.message = bid;
  state.latestBlockHeader = ssz.phase0.BeaconBlockHeader.toViewDU({
    ...ssz.phase0.BeaconBlockHeader.defaultValue(),
    bodyRoot: ssz.pq.BeaconBlockBody.hashTreeRoot(body),
  });
  for (let i = 0; i < SLOTS_PER_HISTORICAL_ROOT; i++) {
    state.executionPayloadAvailability.set(i, true);
  }

  // The lookahead and the PTC window come from the shufflings, which the cached state computes
  const cachedState = createCachedBeaconState(state, createEmptyEpochCacheImmutableData(config, state), {
    skipSyncCommitteeCache: true,
  });
  cachedState.proposerLookahead = ssz.fulu.ProposerLookahead.toViewDU(
    initializeProposerLookahead(cachedState as unknown as CachedBeaconStateElectra)
  );
  cachedState.ptcWindow = ssz.gloas.PayloadTimelinessCommitteeWindow.toViewDU(
    initializePtcWindow(cachedState as unknown as CachedBeaconStateFulu)
  );
  cachedState.commit();
  return cachedState;
}
