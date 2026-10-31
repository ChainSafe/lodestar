import * as fs from "node:fs";
import {config} from "@lodestar/config/default";
import * as era from "@lodestar/era";
import bindings from "../src/index.js";
import {pubkeyCache} from "../src/pubkeys.js";
import {getEraFilePaths, getFirstEraFilePath} from "./eraFiles.ts";
import {getPubkeyCacheCapacityForState, getSerializedGenesisValidatorsRoot} from "./serializedState.ts";

console.log("loaded bindings");

function printDuration<R>(label: string, fn: () => R): R {
  console.time(label);
  const result = fn();
  console.timeEnd(label);
  return result;
}

async function printDurationAsync<R>(label: string, fn: () => Promise<R>): Promise<R> {
  console.time(label);
  const result = await fn();
  console.timeEnd(label);
  return result;
}

const PKIX_FILE = "./mainnet.pkix";
const hasPkix = printDuration("check for pkix file", () => {
  try {
    fs.accessSync(PKIX_FILE);
    return true;
  } catch {
    return false;
  }
});

const reader = await printDurationAsync("load era reader", () => era.era.EraReader.open(config, getFirstEraFilePath()));

const nextReader = await printDurationAsync("load era reader", () =>
  era.era.EraReader.open(config, getEraFilePaths()[1])
);

const stateBytes = await printDurationAsync("read serialized state", () => reader.readSerializedState());
const requiredPubkeyCapacity = getPubkeyCacheCapacityForState(stateBytes);

let loadedPkix = false;
if (hasPkix) {
  try {
    printDuration("load pkix from disk", () => pubkeyCache.load(PKIX_FILE, requiredPubkeyCapacity));
    loadedPkix = true;
  } catch (error) {
    console.warn("PKIX cache is incompatible or corrupt; rebuilding it from state", error);
  }
}

if (!loadedPkix || pubkeyCache.capacity < requiredPubkeyCapacity) {
  printDuration("reserve pubkey cache", () => {
    pubkeyCache.ensureCapacity(requiredPubkeyCapacity);
  });
}

const nativeConfig = new bindings.BeaconConfig(config, getSerializedGenesisValidatorsRoot(stateBytes));
const state = printDuration("create state view", () =>
  bindings.BeaconStateView.createFromBytes(stateBytes, nativeConfig)
);

const signedBlockBytes = (await printDurationAsync("read serialized block", () =>
  nextReader.readSerializedBlock(state.slot + 1)
)) as Uint8Array;

printDuration("state transition", () => state.stateTransition(signedBlockBytes, false));

printDuration("write pkix to disk", () => pubkeyCache.save(PKIX_FILE));

printDuration("get slot", () => state.slot);
printDuration("get fork", () => state.fork);
printDuration("get epoch", () => state.epoch);
printDuration("get genesisTime", () => state.genesisTime);
printDuration("get genesisValidatorsRoot", () => state.genesisValidatorsRoot);
printDuration("get eth1Data", () => state.eth1Data);
printDuration("get latestBlockHeader", () => state.latestBlockHeader);
printDuration("get previousJustifiedCheckpoint", () => state.previousJustifiedCheckpoint);
printDuration("get currentJustifiedCheckpoint", () => state.currentJustifiedCheckpoint);
printDuration("get previousDecisionRoot", () => state.previousDecisionRoot);
printDuration("get currentDecisionRoot", () => state.currentDecisionRoot);
printDuration("get nextDecisionRoot", () => state.nextDecisionRoot);
printDuration("getShufflingDecisionRoot(state.epoch)", () => state.getShufflingDecisionRoot(state.epoch));
printDuration("previousProposers", () => state.previousProposers);
printDuration("currentProposers", () => state.currentProposers);
printDuration("nextProposers", () => state.nextProposers);
printDuration("currentSyncCommittee", () => state.currentSyncCommittee);
printDuration("nextSyncCommittee", () => state.nextSyncCommittee);
printDuration("currentSyncCommitteeIndexed", () => state.currentSyncCommitteeIndexed);
printDuration("effectiveBalanceIncrements", () => state.effectiveBalanceIncrements);
printDuration("latestExecutionPayloadHeader", () => state.latestExecutionPayloadHeader);
printDuration("syncProposerReward", () => state.syncProposerReward);
printDuration("previousEpochParticipation", () => state.previousEpochParticipation);
printDuration("currentEpochParticipation", () => state.currentEpochParticipation);
printDuration("pendingDepositsCount", () => state.pendingDepositsCount);
printDuration("pendingPartialWithdrawalsCount", () => state.pendingPartialWithdrawalsCount);
printDuration("pendingConsolidationsCount", () => state.pendingConsolidationsCount);
printDuration("clonedCount", () => state.clonedCount);
printDuration("clonedCountWithTransferCache", () => state.clonedCountWithTransferCache);
printDuration("createdWithTransferCache", () => state.createdWithTransferCache);
printDuration("serializeValidators", () => state.serializeValidators());
printDuration("serializedValidatorsSize", () => state.serializedValidatorsSize());
printDuration("serializeValidatorsToBytes", () => {
  const size = state.serializedValidatorsSize();
  const output = new Uint8Array(size);
  const bytesWritten = state.serializeValidatorsToBytes(output, 0);
  console.log(`  wrote ${bytesWritten} bytes`);
  return output;
});
printDuration("getBalance(0)", () => state.getBalance(0));
printDuration("getBalance(100)", () => state.getBalance(100));
printDuration("getValidator(0)", () => state.getValidator(0));
printDuration("getValidatorStatus(0)", () => state.getValidatorStatus(0));
printDuration("getValidatorStatus(100)", () => state.getValidatorStatus(100));
printDuration("validatorCount", () => state.validatorCount);
printDuration("activeValidatorCount", () => state.activeValidatorCount);
printDuration("getBeaconProposer(state.slot)", () => state.getBeaconProposer(state.slot));
printDuration("getIndexedSyncCommitteeAtEpoch(state.epoch)", () => state.getIndexedSyncCommitteeAtEpoch(state.epoch));
printDuration("getBlockRoot(state.epoch - 1)", () => state.getBlockRoot(state.slot - 1));
printDuration("isMergeTransitionComplete", () => state.isMergeTransitionComplete);
printDuration("getRandaoMix(state.epoch)", () => state.getRandaoMix(state.epoch));
printDuration("historicalSummaries", () => state.historicalSummaries);
printDuration("pendingDeposits", () => state.pendingDeposits);
printDuration("pendingPartialWithdrawals", () => state.pendingPartialWithdrawals);
printDuration("pendingConsolidations", () => state.pendingConsolidations);
printDuration("proposerLookahead", () => state.proposerLookahead);
printDuration("getSingleProof(169n)", () => state.getSingleProof(169n));
const invalidVoluntaryExit = {
  message: {epoch: 0, validatorIndex: 0},
  signature: new Uint8Array(96),
};
printDuration("isValidVoluntaryExit", () => state.isValidVoluntaryExit(invalidVoluntaryExit, false));
printDuration("getVoluntaryExitValidity", () => state.getVoluntaryExitValidity(invalidVoluntaryExit, false));
printDuration("createMultiProof(descriptor for gindex 42)", () =>
  state.createMultiProof(Uint8Array.from([0x25, 0xe0]))
);
printDuration("getFinalizedRootProof()", () => state.getFinalizedRootProof());
printDuration("isExecutionStateType", () => state.isExecutionStateType);
printDuration("getEffectiveBalanceIncrementsZeroInactive()", () => state.getEffectiveBalanceIncrementsZeroInactive());
printDuration("computeUnrealizedCheckpoints()", () => state.computeUnrealizedCheckpoints());
printDuration("serialize", () => state.serialize());
printDuration("serializedSize", () => state.serializedSize());
printDuration("serializeToBytes", () => {
  const size = state.serializedSize();
  const output = new Uint8Array(size);
  const bytesWritten = state.serializeToBytes(output, 0);
  console.log(`  wrote ${bytesWritten} bytes`);
  return output;
});
printDuration("hashTreeRoot", () => state.hashTreeRoot());
printDuration("proposerRewards", () => state.proposerRewards);
printDuration("processSlots", () => state.processSlots(state.slot + 1));
