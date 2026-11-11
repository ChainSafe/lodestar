import {createBeaconConfig} from "@lodestar/config";
import {type electra, ssz} from "@lodestar/types";
import {afterEach, assert, describe, expect, it} from "vitest";
import {isStatePostFulu} from "../../packages/state-transition/src/stateView/interface.js";
import {createBeaconStateView} from "../../packages/state-transition/src/stateView/stateViewFactory.js";
import {chainConfig, createNative, signedDeposit} from "./depositCacheFixture.js";

type Scenario = {
  name: string;
  deposits: electra.PendingDeposit[];
  replacement?: electra.PendingDeposit[];
};

describe("TypeScript/native deposit cache parity", () => {
  const builder = signedDeposit(301);
  const validator = signedDeposit(301, 1);
  const otherBuilder = signedDeposit(302);
  const invalid = Array.from({length: 40}, (_, index) => ({...validator, amount: validator.amount + index + 1}));
  const malformed = {...builder, signature: new Uint8Array(96)};
  const infinity = {...builder, signature: new Uint8Array(96)};
  infinity.signature[0] = 0xc0;
  const unknownKey = {...builder, pubkey: new Uint8Array(48)};
  const knownBuilder = signedDeposit(0x01000000);
  const scenarios: Scenario[] = [
    {
      deposits: [...invalid, builder, validator],
      name: "invalid validator prefix before a builder and validator top-up",
    },
    {deposits: [validator, ...invalid, builder], name: "valid validator prevents builder onboarding"},
    {deposits: [builder, ...invalid, validator], name: "valid builder turns later invalid signatures into top-ups"},
    {
      deposits: [...invalid, signedDeposit(303, 1), otherBuilder],
      name: "unrelated validator backlog does not affect another builder",
    },
    {deposits: [malformed, infinity, builder], name: "malformed and infinity signatures do not hide a valid builder"},
    {deposits: [unknownKey, otherBuilder], name: "invalid key before a different builder"},
    {
      deposits: [malformed, validator, builder, otherBuilder],
      name: "an invalid builder followed by a validator prevents a later builder",
    },
    {deposits: [knownBuilder, builder], name: "existing-validator deposits stay pending"},
    {deposits: [builder, {...builder, slot: builder.slot - 1}], name: "duplicate signed payloads with distinct slots"},
    {
      deposits: [builder, otherBuilder],
      name: "equal-length replacement changes an earlier signature",
      replacement: [malformed, otherBuilder],
    },
    {
      deposits: [builder, otherBuilder, signedDeposit(304), signedDeposit(305)],
      name: "compaction changes the prefix before the inherited cursor",
      replacement: [validator, builder],
    },
  ];
  const views: {release(): void}[] = [];

  afterEach(() => {
    for (const view of views) view.release();
    views.length = 0;
  });

  it.each(scenarios)("$name", ({name, deposits, replacement}) => {
    let coldRoot: Uint8Array | undefined;
    for (const warm of [false, true]) {
      const fixture = createNative(deposits);
      let actual = fixture.state;
      const config = createBeaconConfig(chainConfig, fixture.value.genesisValidatorsRoot);
      let expected = createBeaconStateView({config, nativeStateTransition: false, stateBytes: fixture.bytes});
      views.push(actual, expected);
      const initialRoot = actual.hashTreeRoot();
      const context = `${name}, warm=${warm}`;
      expect(initialRoot, `${context}: initial native root`).toEqual(expected.hashTreeRoot());

      if (warm) {
        assert(isStatePostFulu(expected), `${context}: expected Fulu state`);
        const limits = replacement ? [1] : [1, 7, 32, 10_000];
        for (const limit of limits) {
          actual.preVerifyBuilderDepositsPreGloas(limit, 60_000);
          expected.preVerifyBuilderDepositsPreGloas(limit, 60_000);
        }
      }
      expect(actual.hashTreeRoot(), `${context}: native warm-up changed state`).toEqual(initialRoot);
      expect(expected.hashTreeRoot(), `${context}: TS warm-up changed state`).toEqual(initialRoot);

      if (replacement) {
        fixture.value.pendingDeposits = replacement;
        const bytes = ssz.fulu.BeaconState.serialize(fixture.value);
        actual = actual.loadOtherState(bytes);
        expected = expected.loadOtherState(bytes);
        views.push(actual, expected);
        if (warm) {
          assert(isStatePostFulu(expected), `${context}: expected reloaded Fulu state`);
          actual.preVerifyBuilderDepositsPreGloas(1, 60_000);
          expected.preVerifyBuilderDepositsPreGloas(1, 60_000);
        }
      }

      const nativePost = actual.processSlots(actual.slot + 1, {dontTransferCache: true});
      views.push(nativePost);
      const tsPost = expected.processSlots(expected.slot + 1, {dontTransferCache: true});
      views.push(tsPost);
      const nativeValue = ssz.gloas.BeaconState.deserialize(nativePost.serialize());
      const tsValue = ssz.gloas.BeaconState.deserialize(tsPost.serialize());
      expect(nativeValue.builders, `${context}: builder registry`).toEqual(tsValue.builders);
      expect(nativeValue.pendingDeposits, `${context}: retained deposit order`).toEqual(tsValue.pendingDeposits);
      expect(nativePost.hashTreeRoot(), `${context}: fork root`).toEqual(tsPost.hashTreeRoot());
      if (coldRoot) {
        expect(tsPost.hashTreeRoot(), `${context}: warm/cold root`).toEqual(coldRoot);
      } else {
        coldRoot = tsPost.hashTreeRoot();
      }
    }
  });
});
