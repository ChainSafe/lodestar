import fs from "node:fs";
import {ApiError, getClient} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {NetworkName} from "@lodestar/config/networks.js";
import {phase0, ssz} from "@lodestar/types";
import {
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  AttesterFlags,
  beforeProcessEpoch,
  parseAttesterFlags,
  processSlots,
} from "../../src/index.js";
import {getInfuraBeaconUrl} from "../utils/infura.js";
import {createCachedBeaconStateTest} from "../utils/state.js";
import {csvAppend, readCsv} from "./csv.js";

// Understand the real network characteristics regarding epoch transitions to accurately produce performance test data.
//
// To run do:
//
// ```
// NETWORK=mainnet node_modules/.bin/ts-node packages/state-transition/test/perf/analyzeEpochs.ts
// ```
//
// Example of output CSV
//
// ```csv
// epoch,validatorCount,effectiveBalance,slashed,activationEligibilityEpoch,activationEpoch,exitEpoch,withdrawableEpoch,prevSourceAttester,prevTargetAttester,prevHeadAttester,currSourceAttester,currTargetAttester,currHeadAttester,unslashed,eligibleAttester,indicesEligibleForActivation,indicesEligibleForActivationQueue,indicesToEject,indicesToSlash,previousEpochAttestations,currentEpochAttestations,previousEpochAttestationsBits,currentEpochAttestationsBits
// 58762,216541,0,0,0,0,0,0,211468,208873,202466,204485,194868,194650,216395,212020,4344,0,0,0,3271,3508,86.3090797921125,81.38854047890536
// 58763,216541,0,0,0,0,0,0,211113,201496,201223,204842,200768,194473,216395,212024,4340,0,0,0,3815,3029,79.86212319790302,87.068669527897
// ```

type EpochData = {
  epoch: number;
  validatorCount: number;

  indicesEligibleForActivation: number;
  indicesEligibleForActivationQueue: number;
  indicesToEject: number;
  indicesToSlash: number;

  previousEpochAttestations: number;
  currentEpochAttestations: number;
  previousEpochAttestationsBits: number;
  currentEpochAttestationsBits: number;
} & AttesterFlagsCount &
  ValidatorChangesCount;

type AttesterFlagsCount = Record<keyof AttesterFlags, number>;
const attesterFlagsCountZero: AttesterFlagsCount = {
  prevSourceAttester: 0,
  prevTargetAttester: 0,
  prevHeadAttester: 0,
  currSourceAttester: 0,
  currTargetAttester: 0,
  currHeadAttester: 0,
  unslashed: 0,
  eligibleAttester: 0,
};

type ValidatorChangesCount = Record<keyof Omit<phase0.Validator, "pubkey" | "withdrawalCredentials">, number>;
const validatorChangesCountZero: ValidatorChangesCount = {
  effectiveBalance: 0,
  slashed: 0,
  activationEligibilityEpoch: 0,
  activationEpoch: 0,
  exitEpoch: 0,
  withdrawableEpoch: 0,
};

async function analyzeEpochs(network: NetworkName, fromEpoch?: number): Promise<void> {
  // Persist summary of epoch data as CSV
  const csvPath = `epoch_data_${network}.csv`;
  const currCsv = fs.existsSync(csvPath) ? readCsv<EpochData>(csvPath) : [];
  const writeToCsv = csvAppend<EpochData>(csvPath);

  const baseUrl = getInfuraBeaconUrl(network);
  // Long timeout to download states
  const client = getClient({baseUrl, timeoutMs: 5 * 60 * 1000}, {config});

  // Start at epoch 1 since 0 will go and fetch state at slot -1
  const maxEpoch = fromEpoch ?? Math.max(1, ...currCsv.map((row) => row.epoch));

  const res = await client.beacon.getBlockHeader("head");
  ApiError.assert(res);
  const header = res.response.data;
  const currentEpoch = computeEpochAtSlot(header.header.message.slot);

  for (let epoch = maxEpoch; epoch < currentEpoch; epoch++) {
    const stateSlot = computeStartSlotAtEpoch(epoch) - 1;

    const res = await client.debug.getState(String(stateSlot));
    ApiError.assert(res);
    const state = res.response.data;

    const preEpoch = computeEpochAtSlot(state.slot);
    const nextEpochSlot = computeStartSlotAtEpoch(preEpoch + 1);
    const stateTB = ssz.phase0.BeaconState.toViewDU(state as phase0.BeaconState);
    const postState = createCachedBeaconStateTest(stateTB, config);

    const epochProcess = beforeProcessEpoch(postState);
    processSlots(postState, nextEpochSlot);

    const validatorCount = state.validators.length;

    const validatorChangesCount = {...validatorChangesCountZero};
    const validatorKeys = Object.keys(validatorChangesCountZero) as (keyof typeof validatorChangesCountZero)[];
    for (let i = 0; i < validatorCount; i++) {
      const validatorPrev = state.validators[i];
      const validatorNext = postState.validators.getReadonly(i);
      for (const key of validatorKeys) {
        const valuePrev = validatorPrev[key];
        const valueNext = validatorNext[key];
        if (valuePrev !== valueNext) validatorChangesCount[key]++;
      }
    }

    const attesterFlagsCount = {...attesterFlagsCountZero};
    const keys = Object.keys(attesterFlagsCountZero) as (keyof typeof attesterFlagsCountZero)[];
    for (const status of epochProcess.statuses) {
      const flags = parseAttesterFlags(status.flags);
      for (const key of keys) {
        if (flags[key]) attesterFlagsCount[key]++;
      }
    }

    const {previousEpochAttestations, currentEpochAttestations} = state as phase0.BeaconState;

    // eslint-disable-next-line no-console
    console.log(`Processed epoch ${epoch}`);
    writeToCsv({
      epoch,
      validatorCount: state.validators.length,

      ...validatorChangesCount,
      ...attesterFlagsCount,

      indicesEligibleForActivation: epochProcess.indicesEligibleForActivation.length,
      indicesEligibleForActivationQueue: epochProcess.indicesEligibleForActivationQueue.length,
      indicesToEject: epochProcess.indicesToEject.length,
      indicesToSlash: epochProcess.indicesToSlash.length,

      previousEpochAttestations: previousEpochAttestations.length,
      currentEpochAttestations: currentEpochAttestations.length,
      previousEpochAttestationsBits: countAttBits(previousEpochAttestations as phase0.PendingAttestation[]),
      currentEpochAttestationsBits: countAttBits(currentEpochAttestations as phase0.PendingAttestation[]),
    });

    // -- allForks
    // processEffectiveBalanceUpdates: function of effectiveBalance changes
    // processEth1DataReset: free
    // processHistoricalRootsUpdate: free
    // processJustificationAndFinalization: free
    // processRandaoMixesReset: free
    // processRegistryUpdates: function of registry updates
    // processSlashingsAllForks: function of process.indicesToSlash
    // processSlashingsReset: free
    // -- altair
    // processInactivityUpdates: -
    // processParticipationFlagUpdates: -
    // processRewardsAndPenalties: -
    // processSyncCommitteeUpdates: -
    // -- phase0
    // processParticipationRecordUpdates: free
    // processPendingAttestations: function of attestation count + bits per att
    // processRewardsAndPenalties: function of average flags per validator
  }
}

function countAttBits(atts: phase0.PendingAttestation[]): number {
  let totalBits = 0;
  for (const att of atts) {
    totalBits += att.aggregationBits.getTrueBitIndexes().length;
  }
  return totalBits / atts.length;
}

const fromEpoch = process.env.FROM_EPOCH !== undefined ? parseInt(process.env.FROM_EPOCH) : undefined;
const network = process.env.NETWORK;
if (!network) {
  throw Error("Must define process.env.NETWORK");
}

analyzeEpochs(network as NetworkName, fromEpoch).catch((e: Error) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
