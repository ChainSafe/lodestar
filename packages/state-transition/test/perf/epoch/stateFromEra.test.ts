import {basename} from "node:path";
import {bench, describe, setBenchOpts} from "@chainsafe/benchmark";
import {createChainForkConfig} from "@lodestar/config";
import {type NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {era} from "@lodestar/era";
import {ForkSeq} from "@lodestar/params";
import {processEpoch} from "../../../src/epoch/index.js";
import {processEffectiveBalanceUpdates} from "../../../src/epoch/processEffectiveBalanceUpdates.js";
import {processEth1DataReset} from "../../../src/epoch/processEth1DataReset.js";
import {processHistoricalSummariesUpdate} from "../../../src/epoch/processHistoricalSummariesUpdate.js";
import {processInactivityUpdates} from "../../../src/epoch/processInactivityUpdates.js";
import {processJustificationAndFinalization} from "../../../src/epoch/processJustificationAndFinalization.js";
import {processParticipationFlagUpdates} from "../../../src/epoch/processParticipationFlagUpdates.js";
import {processPendingConsolidations} from "../../../src/epoch/processPendingConsolidations.js";
import {processPendingDeposits} from "../../../src/epoch/processPendingDeposits.js";
import {processProposerLookahead} from "../../../src/epoch/processProposerLookahead.js";
import {processRandaoMixesReset} from "../../../src/epoch/processRandaoMixesReset.js";
import {processRegistryUpdates} from "../../../src/epoch/processRegistryUpdates.js";
import {processRewardsAndPenalties} from "../../../src/epoch/processRewardsAndPenalties.js";
import {processSlashings} from "../../../src/epoch/processSlashings.js";
import {processSlashingsReset} from "../../../src/epoch/processSlashingsReset.js";
import {processSyncCommitteeUpdates} from "../../../src/epoch/processSyncCommitteeUpdates.js";
import {
  type CachedBeaconStateAllForks,
  type CachedBeaconStateAltair,
  type CachedBeaconStateCapella,
  type CachedBeaconStateElectra,
  type CachedBeaconStateFulu,
  beforeProcessEpoch,
} from "../../../src/index.js";
import {beforeValue} from "../../utils/beforeValueBenchmark.js";
import {createCachedBeaconStateTest} from "../../utils/state.js";

const eraFilePath = process.env.ERA_FILE ?? "ERA_FILE-not-set";
const network = getNetworkName(process.env.ERA_NETWORK);
const stateId = `${network}_${basename(eraFilePath)}`;

describe(`processEpoch from era - ${stateId}`, () => {
  setBenchOpts({
    yieldEventLoopAfterEach: true,
  });

  const stateOg = beforeValue(
    async (): Promise<CachedBeaconStateAllForks> => loadStateFromEra(network, getEraFilePath()),
    300_000
  );
  const fork = beforeValue((): ForkSeq => stateOg.value.config.getForkSeq(stateOg.value.slot));

  bench({
    id: `${stateId} - beforeProcessEpoch`,
    fn: (): void => {
      beforeProcessEpoch(stateOg.value);
    },
  });

  const cache = beforeValue(() => beforeProcessEpoch(stateOg.value));

  bench({
    id: `${stateId} - processJustificationAndFinalization`,
    beforeEach: (): CachedBeaconStateAllForks => stateOg.value.clone(),
    fn: (state): void => processJustificationAndFinalization(state, cache.value),
  });

  bench({
    id: `${stateId} - processInactivityUpdates`,
    beforeEach: (): CachedBeaconStateAllForks => stateOg.value.clone(),
    fn: (state): void => {
      if (fork.value < ForkSeq.altair) {
        return;
      }
      processInactivityUpdates(state as CachedBeaconStateAltair, cache.value);
    },
  });

  bench({
    id: `${stateId} - processRegistryUpdates`,
    beforeEach: (): CachedBeaconStateAllForks => stateOg.value.clone(),
    fn: (state): void => processRegistryUpdates(fork.value, state, cache.value),
  });

  bench({
    id: `${stateId} - processSlashings`,
    beforeEach: (): CachedBeaconStateAllForks => stateOg.value.clone(),
    fn: (state): void => {
      processSlashings(state, cache.value, false);
    },
  });

  bench({
    id: `${stateId} - processRewardsAndPenalties`,
    beforeEach: (): CachedBeaconStateAllForks => stateOg.value.clone(),
    fn: (state): void => processRewardsAndPenalties(state, cache.value, []),
  });

  bench({
    id: `${stateId} - processEth1DataReset`,
    beforeEach: (): CachedBeaconStateAllForks => stateOg.value.clone(),
    fn: (state): void => processEth1DataReset(state, cache.value),
  });

  bench({
    id: `${stateId} - processPendingDeposits`,
    beforeEach: (): CachedBeaconStateAllForks => stateOg.value.clone(),
    fn: (state): void => {
      if (fork.value < ForkSeq.electra) {
        return;
      }
      processPendingDeposits(state as CachedBeaconStateElectra, cache.value);
    },
  });

  bench({
    id: `${stateId} - processPendingConsolidations`,
    beforeEach: (): CachedBeaconStateAllForks => stateOg.value.clone(),
    fn: (state): void => {
      if (fork.value < ForkSeq.electra) {
        return;
      }
      processPendingConsolidations(state as CachedBeaconStateElectra, cache.value);
    },
  });

  bench({
    id: `${stateId} - processEffectiveBalanceUpdates`,
    beforeEach: (): CachedBeaconStateAllForks => stateOg.value.clone(),
    fn: (state): void => {
      processEffectiveBalanceUpdates(fork.value, state, cache.value);
    },
  });

  bench({
    id: `${stateId} - processSlashingsReset`,
    beforeEach: (): CachedBeaconStateAllForks => stateOg.value.clone(),
    fn: (state): void => processSlashingsReset(state, cache.value),
  });

  bench({
    id: `${stateId} - processRandaoMixesReset`,
    beforeEach: (): CachedBeaconStateAllForks => stateOg.value.clone(),
    fn: (state): void => processRandaoMixesReset(state, cache.value),
  });

  bench({
    id: `${stateId} - processHistoricalSummariesUpdate`,
    beforeEach: (): CachedBeaconStateAllForks => stateOg.value.clone(),
    fn: (state): void => {
      if (fork.value < ForkSeq.capella) {
        return;
      }
      processHistoricalSummariesUpdate(state as CachedBeaconStateCapella, cache.value);
    },
  });

  bench({
    id: `${stateId} - processParticipationFlagUpdates`,
    beforeEach: (): CachedBeaconStateAllForks => stateOg.value.clone(),
    fn: (state): void => {
      if (fork.value < ForkSeq.altair) {
        return;
      }
      processParticipationFlagUpdates(state as CachedBeaconStateAltair);
    },
  });

  bench({
    id: `${stateId} - processSyncCommitteeUpdates`,
    convergeFactor: 1 / 100,
    beforeEach: (): CachedBeaconStateAllForks => stateOg.value.clone(),
    fn: (state): void => {
      if (fork.value < ForkSeq.altair) {
        return;
      }
      processSyncCommitteeUpdates(fork.value, state as CachedBeaconStateAltair);
    },
  });

  bench({
    id: `${stateId} - processProposerLookahead`,
    beforeEach: (): CachedBeaconStateAllForks => stateOg.value.clone(),
    fn: (state): void => {
      if (fork.value < ForkSeq.fulu) {
        return;
      }
      processProposerLookahead(fork.value, state as CachedBeaconStateFulu, cache.value);
    },
  });

  bench({
    id: `${stateId} - processEpoch`,
    beforeEach: (): {state: CachedBeaconStateAllForks; cache: ReturnType<typeof beforeProcessEpoch>} => {
      const state = stateOg.value.clone();
      return {state, cache: beforeProcessEpoch(state)};
    },
    fn: ({state, cache}): void => {
      processEpoch(fork.value, state, cache);
    },
  });
});

function getEraFilePath(): string {
  const eraFile = process.env.ERA_FILE;
  if (!eraFile) {
    throw new Error("Set ERA_FILE to the path of the .era file to benchmark");
  }
  return eraFile;
}

function getNetworkName(networkEnv: string | undefined): NetworkName {
  const network = networkEnv ?? "mainnet";
  if (!(network in networksChainConfig)) {
    throw new Error(`Invalid ERA_NETWORK: ${network}`);
  }
  return network as NetworkName;
}

async function loadStateFromEra(network: NetworkName, eraFilePath: string): Promise<CachedBeaconStateAllForks> {
  const config = createChainForkConfig(networksChainConfig[network]);
  const reader = await era.EraReader.open(config, eraFilePath);

  try {
    const stateBytes = await reader.readSerializedState();
    const slot = Number(new DataView(stateBytes.buffer, stateBytes.byteOffset).getBigUint64(40, true));
    const stateView = config.getForkTypes(slot).BeaconState.deserializeToViewDU(stateBytes);
    const cachedState = createCachedBeaconStateTest(stateView, config);
    cachedState.hashTreeRoot();
    return cachedState;
  } finally {
    await reader.close();
  }
}
