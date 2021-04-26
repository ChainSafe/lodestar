import bls, {CoordType} from "@chainsafe/bls";
import {phase0} from "@chainsafe/lodestar-types";
import {verifyMerkleBranch, bigIntMin} from "@chainsafe/lodestar-utils";

import {DEPOSIT_CONTRACT_TREE_DEPTH, FAR_FUTURE_EPOCH} from "../../../constants";
import {computeDomain, computeSigningRoot, increaseBalance} from "../../../util";
import {CachedBeaconState} from "../../../fast";

export function processDeposit(state: CachedBeaconState<phase0.BeaconState>, deposit: phase0.Deposit): void {
  const {config, validators, epochCtx} = state;
  const {EFFECTIVE_BALANCE_INCREMENT, MAX_EFFECTIVE_BALANCE} = config.params;
  // verify the merkle branch
  if (
    !verifyMerkleBranch(
      config.types.phase0.DepositData.hashTreeRoot(deposit.data),
      Array.from(deposit.proof).map((p) => p.valueOf() as Uint8Array),
      DEPOSIT_CONTRACT_TREE_DEPTH + 1,
      state.eth1DepositIndex,
      state.eth1Data.depositRoot.valueOf() as Uint8Array
    )
  ) {
    throw new Error("Deposit has invalid merkle proof");
  }

  // deposits must be processed in order
  state.eth1DepositIndex += 1;

  const pubkey = deposit.data.pubkey.valueOf() as Uint8Array; // Drop tree
  const amount = deposit.data.amount;
  const cachedIndex = epochCtx.pubkey2index.get(pubkey);
  if (cachedIndex === undefined || !Number.isSafeInteger(cachedIndex) || cachedIndex >= validators.length) {
    // verify the deposit signature (proof of posession) which is not checked by the deposit contract
    const depositMessage = {
      pubkey: deposit.data.pubkey, // Retain tree for hashing
      withdrawalCredentials: deposit.data.withdrawalCredentials, // Retain tree for hashing
      amount: deposit.data.amount,
    };
    // fork-agnostic domain since deposits are valid across forks
    const domain = computeDomain(config, config.params.DOMAIN_DEPOSIT);
    const signingRoot = computeSigningRoot(config, config.types.phase0.DepositMessage, depositMessage, domain);
    try {
      // Pubkeys must be checked for group + inf. This must be done only once when the validator deposit is processed
      // > Check group + inf here
      // !!! UNTIL MERGED https://github.com/ChainSafe/bls/pull/91
      // @ts-ignore
      const publicKey = bls.PublicKey.fromBytes(pubkey, CoordType.affine, true);
      const signature = bls.Signature.fromBytes(deposit.data.signature.valueOf() as Uint8Array, CoordType.affine, true);
      if (!signature.verify(publicKey, signingRoot)) {
        return;
      }
    } catch (e) {
      return; // Catch all BLS errors: failed key validation, failed signature validation, invalid signature
    }

    // add validator and balance entries
    validators.push({
      pubkey,
      withdrawalCredentials: deposit.data.withdrawalCredentials.valueOf() as Uint8Array, // Drop tree
      activationEligibilityEpoch: FAR_FUTURE_EPOCH,
      activationEpoch: FAR_FUTURE_EPOCH,
      exitEpoch: FAR_FUTURE_EPOCH,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
      effectiveBalance: bigIntMin(amount - (amount % EFFECTIVE_BALANCE_INCREMENT), MAX_EFFECTIVE_BALANCE),
      slashed: false,
    });
    state.balances.push(amount);

    // add participation caches
    state.previousEpochParticipation.pushStatus({timelyHead: false, timelySource: false, timelyTarget: false});
    state.currentEpochParticipation.pushStatus({timelyHead: false, timelySource: false, timelyTarget: false});

    // now that there is a new validator, update the epoch context with the new pubkey
    epochCtx.addPubkey(validators.length - 1, pubkey);
  } else {
    // increase balance by deposit amount
    increaseBalance(state, cachedIndex, amount);
  }
}
