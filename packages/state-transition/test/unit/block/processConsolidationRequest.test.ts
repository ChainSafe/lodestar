import {processConsolidationRequest} from "../../../src/block";
import {describe, expect, it} from "vitest";
import {ssz} from "@lodestar/types";
import {
  BLS_WITHDRAWAL_PREFIX, COMPOUNDING_WITHDRAWAL_PREFIX,
  FAR_FUTURE_EPOCH,
  MAX_EFFECTIVE_BALANCE,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SIZE
} from "@lodestar/params";
import {generateValidators} from "../../utils/validator.js";
import {generateCachedElectraState} from "../../../../beacon-node/test/utils/state.js";
import bls from "@chainsafe/blst";
import {digest} from "@chainsafe/as-sha256";

describe.only("processConsolidationRequest", () => {
  it.only("rejects BLS withdrawal credentials", () => {
    const electraForkEpoch = 400000;
    const currentEpoch = electraForkEpoch + 10;
    const currentSlot = SLOTS_PER_EPOCH * currentEpoch;

    const activationEpoch = electraForkEpoch - 10000;
    const exitEpoch = FAR_FUTURE_EPOCH;

    const validatorOpts = {
      activationEpoch,
      activation: activationEpoch,
      effectiveBalance: MAX_EFFECTIVE_BALANCE,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
      exitEpoch,
      exit: exitEpoch,
    };
    const validators = generateValidators(SYNC_COMMITTEE_SIZE, validatorOpts);
    for (let i = 0; i < SYNC_COMMITTEE_SIZE; i++) {
      const buffer = Buffer.alloc(32, 0);
      buffer.writeInt16BE(i + 1, 30); // Offset to ensure the SK is less than the order
      const sk = bls.SecretKey.fromBytes(buffer);
      validators[i].pubkey = sk.toPublicKey().toBytes();
    }

    let [sourceValidator, targetValidator] = [validators[0], validators[1]];
    sourceValidator.withdrawalCredentials = digest(sourceValidator.pubkey);
    sourceValidator.withdrawalCredentials[0] = BLS_WITHDRAWAL_PREFIX;
    targetValidator.withdrawalCredentials = digest(targetValidator.pubkey);
    targetValidator.withdrawalCredentials[0] = COMPOUNDING_WITHDRAWAL_PREFIX;

    let state = generateCachedElectraState({slot: currentSlot + 1, validators}, electraForkEpoch);
    state.epochCtx.totalActiveBalanceIncrements = 123456789;
    const request = ssz.electra.ConsolidationRequest.defaultValue();

    request.sourcePubkey = sourceValidator.pubkey;
    request.targetPubkey = targetValidator.pubkey;
    request.sourceAddress = digest(sourceValidator.pubkey).slice(12);

    expect(state.pendingConsolidations.length).eq(0);

    processConsolidationRequest(state, request);

    expect(state.pendingConsolidations.length).eq(0);
  })
});
