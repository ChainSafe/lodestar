import {BUILDER_WITHDRAWAL_PREFIX, DOMAIN_DEPOSIT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {type electra, ssz} from "@lodestar/types";
import {SecretKey} from "../src/blst.js";
import bindings from "../src/index.js";
import {pubkeyCache} from "../src/pubkeys.js";
import {createStfState, stfConfig} from "./stfFixture.js";

export const chainConfig = {...stfConfig, GLOAS_FORK_EPOCH: stfConfig.FULU_FORK_EPOCH + 1};

export function signedDeposit(seed: number, prefix = BUILDER_WITHDRAWAL_PREFIX): electra.PendingDeposit {
  const entropy = new Uint8Array(32);
  new DataView(entropy.buffer).setUint32(0, seed);
  const secret = SecretKey.fromKeygen(entropy);
  const deposit = ssz.electra.PendingDeposit.defaultValue();
  deposit.pubkey = secret.toPublicKey().toBytes();
  deposit.withdrawalCredentials[0] = prefix;
  deposit.amount = 1_000_000_000;
  deposit.slot = chainConfig.GLOAS_FORK_EPOCH * SLOTS_PER_EPOCH - 1;
  const forkRoot = ssz.phase0.ForkData.hashTreeRoot({
    currentVersion: chainConfig.GENESIS_FORK_VERSION,
    genesisValidatorsRoot: new Uint8Array(32),
  });
  const domain = new Uint8Array(32);
  domain.set(DOMAIN_DEPOSIT);
  domain.set(forkRoot.subarray(0, 28), 4);
  deposit.signature = secret
    .sign(ssz.phase0.SigningData.hashTreeRoot({domain, objectRoot: ssz.phase0.DepositMessage.hashTreeRoot(deposit)}))
    .toBytes();
  return deposit;
}

export function createNative(deposits: electra.PendingDeposit[]) {
  const value = createStfState();
  for (let index = value.validators.length; index < 64; index++) {
    const seed = new Uint8Array(32);
    seed[0] = index + 1;
    value.validators.push({...value.validators[0], pubkey: SecretKey.fromKeygen(seed).toPublicKey().toBytes()});
    value.balances.push(32_000_000_000);
    value.previousEpochParticipation.push(0);
    value.currentEpochParticipation.push(0);
    value.inactivityScores.push(0);
  }
  value.pendingDeposits = deposits;
  pubkeyCache.ensureCapacity(value.validators.length);
  const config = new bindings.BeaconConfig(chainConfig, value.genesisValidatorsRoot);
  const bytes = ssz.fulu.BeaconState.serialize(value);
  return {bytes, state: bindings.BeaconStateView.createFromBytes(bytes, config, {pubkeyMode: "trusted"}), value};
}
