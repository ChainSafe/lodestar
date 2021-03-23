import bls from "@chainsafe/bls";
import {phase0} from "@chainsafe/lodestar-types";
import {verifyMerkleBranch, bigIntMin} from "@chainsafe/lodestar-utils";

import {DEPOSIT_CONTRACT_TREE_DEPTH, FAR_FUTURE_EPOCH} from "../../../constants";
import {computeDomain, computeSigningRoot, increaseBalance} from "../../../util";
import {CachedBeaconState} from "../util";

export function processDeposit(state: CachedBeaconState<phase0.BeaconState>, deposit: phase0.Deposit): void {
  const {config, validators, epochCtx} = state;
  const {EFFECTIVE_BALANCE_INCREMENT, MAX_EFFECTIVE_BALANCE} = config.params;
  // verify the merkle branch
  if (
    !verifyMerkleBranch(
      config.types.phase0.DepositData.hashTreeRoot(deposit.data),
      Array.from({length: deposit.proof.length}, (_, i) => deposit.proof[i].valueOf() as Uint8Array),
      DEPOSIT_CONTRACT_TREE_DEPTH + 1,
      state.eth1DepositIndex,
      state.eth1Data.depositRoot.valueOf() as Uint8Array
    )
  ) {
    throw new Error("Deposit has invalid merkle proof");
  }

  // deposits must be processed in order
  state.eth1DepositIndex += 1;

  const pubkey = deposit.data.pubkey;
  const amount = deposit.data.amount;
  const cachedIndex = epochCtx.pubkey2index.get(pubkey);
  if (cachedIndex === undefined || !Number.isSafeInteger(cachedIndex) || cachedIndex >= validators.length) {
    // verify the deposit signature (proof of posession) which is not checked by the deposit contract
    const depositMessage = {
      pubkey: deposit.data.pubkey,
      withdrawalCredentials: deposit.data.withdrawalCredentials,
      amount: deposit.data.amount,
    };
    // fork-agnostic domain since deposits are valid across forks
    const domain = computeDomain(config, config.params.DOMAIN_DEPOSIT);
    const signingRoot = computeSigningRoot(config, config.types.phase0.DepositMessage, depositMessage, domain);
    if (!bls.verify(pubkey.valueOf() as Uint8Array, signingRoot, deposit.data.signature.valueOf() as Uint8Array)) {
      return;
    }

    // add validator and balance entries
    validators.push({
      pubkey: pubkey,
      withdrawalCredentials: deposit.data.withdrawalCredentials,
      activationEligibilityEpoch: FAR_FUTURE_EPOCH,
      activationEpoch: FAR_FUTURE_EPOCH,
      exitEpoch: FAR_FUTURE_EPOCH,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
      effectiveBalance: bigIntMin(amount - (amount % EFFECTIVE_BALANCE_INCREMENT), MAX_EFFECTIVE_BALANCE),
      slashed: false,
    });
    state.balances.push(amount);

    // now that there is a new validator, update the epoch context with the new pubkey
    epochCtx.addPubkey(validators.length - 1, pubkey.valueOf() as Uint8Array);
  } else {
    // increase balance by deposit amount
    increaseBalance(state, cachedIndex, amount);
  }
}
