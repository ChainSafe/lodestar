import {ChainForkConfig, createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as chainConfig} from "@lodestar/config/default";
import {FAR_FUTURE_EPOCH, MAX_EFFECTIVE_BALANCE, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {electra, ssz} from "@lodestar/types";
import {
  BeaconStateElectra,
  CachedBeaconStateElectra,
  createCachedBeaconState,
  createPubkeyCache,
} from "../../src/index.js";
import {generateValidators} from "./validator.js";

type TestBeaconState = Partial<electra.BeaconState>;

function createElectraForkConfig(electraForkEpoch: number): ChainForkConfig {
  return createChainForkConfig({
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: electraForkEpoch,
  });
}

function generateElectraState(chainForkConfig: ChainForkConfig, opts: TestBeaconState = {}): BeaconStateElectra {
  const stateSlot = opts.slot ?? 0;
  const state = chainForkConfig.getForkTypes(stateSlot).BeaconState.defaultValue() as electra.BeaconState;

  const validatorOpts = {
    activation: 0,
    withdrawableEpoch: FAR_FUTURE_EPOCH,
    exit: FAR_FUTURE_EPOCH,
  };
  const validators = opts.validators ?? generateValidators(16, validatorOpts);

  state.genesisTime = 1606824000; // Fixed timestamp for deterministic tests
  state.slot = stateSlot;
  state.fork.previousVersion = chainConfig.GENESIS_FORK_VERSION;
  state.fork.currentVersion = chainConfig.GENESIS_FORK_VERSION;
  state.latestBlockHeader.bodyRoot = ssz.phase0.BeaconBlockBody.hashTreeRoot(ssz.phase0.BeaconBlockBody.defaultValue());
  state.validators = validators;
  state.balances = Array.from({length: validators.length}, () => MAX_EFFECTIVE_BALANCE);

  state.previousEpochParticipation = [...[0xff, 0xff], ...Array.from({length: validators.length - 2}, () => 0)];
  state.currentEpochParticipation = [...[0xff, 0xff], ...Array.from({length: validators.length - 2}, () => 0)];
  state.currentSyncCommittee = {
    pubkeys: Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) => validators[i % validators.length].pubkey),
    aggregatePubkey: ssz.BLSPubkey.defaultValue(),
  };
  state.nextSyncCommittee = {
    pubkeys: Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) => validators[i % validators.length].pubkey),
    aggregatePubkey: ssz.BLSPubkey.defaultValue(),
  };

  state.depositRequestsStartIndex = 2023n;
  state.latestExecutionPayloadHeader = ssz.electra.ExecutionPayloadHeader.defaultValue();

  // Apply overrides from opts after all defaults are set
  Object.assign(state, opts);

  return ssz.electra.BeaconState.toViewDU(state);
}

export function generateCachedElectraState(opts?: TestBeaconState, electraForkEpoch = 0): CachedBeaconStateElectra {
  const chainForkConfig = createElectraForkConfig(electraForkEpoch);
  const state = generateElectraState(chainForkConfig, opts);

  return createCachedBeaconState(state as BeaconStateElectra, {
    config: createBeaconConfig(chainForkConfig, state.genesisValidatorsRoot),
    pubkeyCache: createPubkeyCache(),
  });
}
