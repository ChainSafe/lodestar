import {BeaconConfig} from "@lodestar/config";
import {SecretKey} from "@lodestar/native/blst";
import {DOMAIN_DEPOSIT, FAR_FUTURE_EPOCH, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {electra, ssz} from "@lodestar/types";
import {BeaconStateAllForks, BeaconStateFulu, BeaconStateGloas} from "../../src/cache/types.js";
import {ZERO_HASH} from "../../src/constants/index.js";
import {computeDomain} from "../../src/util/domain.js";
import {interopSecretKey} from "../../src/util/interop.js";
import {computeSigningRoot} from "../../src/util/signingRoot.js";

export const finalizedValidatorCount = 64;
export const pubkeyCacheForkEpoch = 4;
export const pubkeyCacheGenesisRoot = Buffer.alloc(32, 0xaa);
export const pubkeyCacheKeyA = interopSecretKey(1000);
export const pubkeyCacheKeyB = interopSecretKey(1001);

export function pubkeyCacheWithdrawalCredentials(prefix: number, fill: number): Uint8Array {
  const credentials = Buffer.alloc(32);
  credentials[0] = prefix;
  credentials.fill(fill, 12);
  return credentials;
}

export function createPubkeyCacheFuluState(config: BeaconConfig, slot: number): BeaconStateFulu {
  const state = ssz.fulu.BeaconState.defaultViewDU();
  state.genesisValidatorsRoot = pubkeyCacheGenesisRoot;
  state.slot = slot;
  state.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: config.FULU_FORK_VERSION,
    currentVersion: config.FULU_FORK_VERSION,
    epoch: 0,
  });
  const pubkeys: Uint8Array[] = [];
  for (let i = 0; i < finalizedValidatorCount; i++) {
    const pubkey = interopSecretKey(i).toPublicKey().toBytes();
    pubkeys.push(pubkey);
    state.validators.push(
      ssz.phase0.Validator.toViewDU({
        ...ssz.phase0.Validator.defaultValue(),
        pubkey,
        withdrawalCredentials: pubkeyCacheWithdrawalCredentials(0x01, i),
        effectiveBalance: 32e9,
        activationEligibilityEpoch: 0,
        activationEpoch: 0,
        exitEpoch: FAR_FUTURE_EPOCH,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      })
    );
    state.balances.push(32e9);
    state.inactivityScores.push(0);
    state.previousEpochParticipation.push(0);
    state.currentEpochParticipation.push(0);
  }
  const syncCommittee = {
    pubkeys: Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) => pubkeys[i % finalizedValidatorCount]),
    aggregatePubkey: pubkeys[0],
  };
  state.currentSyncCommittee = ssz.altair.SyncCommittee.toViewDU(syncCommittee);
  state.nextSyncCommittee = ssz.altair.SyncCommittee.toViewDU(syncCommittee);
  for (const key of ["finalizedCheckpoint", "currentJustifiedCheckpoint", "previousJustifiedCheckpoint"] as const) {
    state[key] = ssz.phase0.Checkpoint.toViewDU({epoch: pubkeyCacheForkEpoch - 2, root: Buffer.alloc(32, 1)});
  }
  state.commit();
  return state;
}

export function addPubkeyCacheDeposits(
  state: Pick<BeaconStateFulu | BeaconStateGloas, "validators" | "pendingDeposits">,
  config: BeaconConfig,
  churn: number,
  prefix: number
): void {
  const deposits = [
    {
      pubkey: state.validators.getReadonly(0).pubkey,
      withdrawalCredentials: pubkeyCacheWithdrawalCredentials(0x01, 0),
      amount: churn,
      signature: Buffer.alloc(96),
      slot: 1,
    },
    signedDeposit(config, pubkeyCacheKeyA, prefix, prefix === 0xb0 ? 5e9 : 32e9),
    signedDeposit(config, pubkeyCacheKeyB, 0x01, 32e9),
  ];
  for (const deposit of deposits) {
    state.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(deposit));
  }
}

export function slashPubkeyCacheFirstValidator(state: Pick<BeaconStateAllForks, "validators">): void {
  const validator = state.validators.get(0);
  validator.slashed = true;
  validator.exitEpoch = pubkeyCacheForkEpoch + 1;
  validator.withdrawableEpoch = pubkeyCacheForkEpoch + 100;
}

function signedDeposit(config: BeaconConfig, key: SecretKey, prefix: number, amount: number): electra.PendingDeposit {
  const message = {
    pubkey: key.toPublicKey().toBytes(),
    withdrawalCredentials: pubkeyCacheWithdrawalCredentials(prefix, prefix + 1),
    amount,
  };
  const domain = computeDomain(DOMAIN_DEPOSIT, config.GENESIS_FORK_VERSION, ZERO_HASH);
  const signingRoot = computeSigningRoot(ssz.phase0.DepositMessage, message, domain);
  return {...message, signature: key.sign(signingRoot).toBytes(), slot: 1};
}
