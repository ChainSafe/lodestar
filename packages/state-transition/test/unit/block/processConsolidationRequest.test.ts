import {describe, expect, it} from "vitest";
import {digest} from "@chainsafe/as-sha256";
import bls from "@chainsafe/blst";
import {
  BLS_WITHDRAWAL_PREFIX,
  COMPOUNDING_WITHDRAWAL_PREFIX,
  FAR_FUTURE_EPOCH,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {generateCachedElectraState} from "../../../../beacon-node/test/utils/state.js";
import {processConsolidationRequest} from "../../../src/block/processConsolidationRequest.js";
import {generateValidators} from "../../utils/validator.js";

describe("processConsolidationRequest", () => {
  it("rejects BLS withdrawal credentials", () => {
    const vc = 32;
    const electraForkEpoch = 400000;
    const currentEpoch = electraForkEpoch + 10;
    const currentSlot = SLOTS_PER_EPOCH * currentEpoch;

    const validators = generateValidators(vc, {
      activation: electraForkEpoch - 10000,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
      exit: FAR_FUTURE_EPOCH,
    });

    for (let i = 0; i < vc; i++) {
      const buffer = Buffer.alloc(32, 0);
      buffer.writeInt16BE(i + 1, 30); // Offset to ensure the SK is less than the order
      const sk = bls.SecretKey.fromBytes(buffer);
      validators[i].pubkey = sk.toPublicKey().toBytes();
    }

    const [sourceValidator, targetValidator] = [validators[0], validators[1]];
    sourceValidator.withdrawalCredentials = digest(sourceValidator.pubkey);
    sourceValidator.withdrawalCredentials[0] = BLS_WITHDRAWAL_PREFIX;
    targetValidator.withdrawalCredentials = digest(targetValidator.pubkey);
    targetValidator.withdrawalCredentials[0] = COMPOUNDING_WITHDRAWAL_PREFIX;

    const state = generateCachedElectraState({slot: currentSlot + 1, validators}, electraForkEpoch);
    state.epochCtx.totalActiveBalanceIncrements = 123456789;

    const request = ssz.electra.ConsolidationRequest.defaultValue();
    request.sourcePubkey = sourceValidator.pubkey;
    request.targetPubkey = targetValidator.pubkey;
    // An attacker could create a new validator with BLS withdrawal credentials where the last twenty
    // bytes of the BLS pubkey are hardcoded to an address that they control. To be clear, the source
    // address field in consolidation requests cannot be set to an arbitrary value.
    request.sourceAddress = digest(sourceValidator.pubkey).slice(12);

    expect(state.pendingConsolidations.length).eq(0);

    processConsolidationRequest(state, request);

    expect(state.pendingConsolidations.length).eq(0);
  });
});
