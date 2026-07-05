import {beforeAll, describe, expect, it} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {createBeaconConfig, defaultChainConfig} from "@lodestar/config";
import {
  BeaconStateAllForks,
  BeaconStateView,
  createCachedBeaconState,
  createPubkeyCache,
} from "@lodestar/state-transition";
import {BLSPubkey, ValidatorIndex, ssz} from "@lodestar/types";
import {effectiveBidValueGwei, getPubkeysForIndices} from "../../../../../src/api/impl/validator/utils.js";

describe("api / impl / validator / utils", () => {
  const vc = 32;

  const pubkeys: BLSPubkey[] = [];
  const indexes: ValidatorIndex[] = [];
  let state: BeaconStateAllForks;
  beforeAll(() => {
    state = ssz.phase0.BeaconState.defaultViewDU();
    const validator = ssz.phase0.Validator.defaultValue();
    const validators = state.validators;
    for (let i = 0; i < vc; i++) {
      indexes.push(i);
      const pubkey = Buffer.alloc(48, i);
      pubkeys.push(pubkey);
      validators.push(ssz.phase0.Validator.toViewDU({...validator, pubkey}));
    }
    state.commit();
  });

  it("getPubkeysForIndices", () => {
    const cachedState = createCachedBeaconState(
      state,
      {
        config: createBeaconConfig(defaultChainConfig, state.genesisValidatorsRoot),
        pubkeyCache: createPubkeyCache(),
      },
      {skipSyncPubkeys: true}
    );
    const pubkeysRes = getPubkeysForIndices(new BeaconStateView(cachedState), indexes);
    expect(pubkeysRes.map(toHexString)).toEqual(pubkeys.map(toHexString));
  });

  it("effectiveBidValueGwei", () => {
    const bid = ssz.gloas.ExecutionPayloadBid.defaultValue();

    const testCases: {value: number; executionPayment: number; maxExecutionPayment: bigint; expected: bigint}[] = [
      // no execution payment, only the bid value counts
      {value: 100, executionPayment: 0, maxExecutionPayment: BigInt(0), expected: BigInt(100)},
      // execution payment within max is credited in full
      {value: 100, executionPayment: 50, maxExecutionPayment: BigInt(50), expected: BigInt(150)},
      // execution payment above max only counts up to the max
      {value: 100, executionPayment: 80, maxExecutionPayment: BigInt(50), expected: BigInt(150)},
      // execution payment is not credited if no max was submitted
      {value: 0, executionPayment: 80, maxExecutionPayment: BigInt(0), expected: BigInt(0)},
    ];

    for (const {value, executionPayment, maxExecutionPayment, expected} of testCases) {
      bid.value = value;
      bid.executionPayment = executionPayment;
      expect(effectiveBidValueGwei(bid, maxExecutionPayment)).toBe(expected);
    }
  });
});
