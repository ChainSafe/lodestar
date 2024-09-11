import {describe, it, expect} from "vitest";
import {ssz} from "@lodestar/types";
import {mainnetChainConfig} from "@lodestar/config/networks";
import {createChainForkConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {loadStateAndValidators} from "../../../src/util/loadState/loadState.js";

describe("loadStateAndValidators", () => {
  const numValidator = 10;
  const config = createChainForkConfig(mainnetChainConfig);

  const testCases: {name: ForkName; slot: number}[] = [
    {name: ForkName.phase0, slot: 100},
    {name: ForkName.altair, slot: mainnetChainConfig.ALTAIR_FORK_EPOCH * SLOTS_PER_EPOCH + 100},
    {name: ForkName.capella, slot: mainnetChainConfig.CAPELLA_FORK_EPOCH * SLOTS_PER_EPOCH + 100},
    {name: ForkName.deneb, slot: mainnetChainConfig.DENEB_FORK_EPOCH * SLOTS_PER_EPOCH + 100},
  ];

  for (const {name, slot} of testCases) {
    it(`fork: ${name}, slot: ${slot}`, () => {
      const state = config.getForkTypes(slot).BeaconState.defaultViewDU();
      state.slot = slot;
      for (let i = 0; i < numValidator; i++) {
        const validator = ssz.phase0.Validator.defaultViewDU();
        validator.pubkey = Buffer.alloc(48, i);
        state.validators.push(validator);
        state.balances.push(32 * 1e9);
      }
      state.commit();

      const stateBytes = state.serialize();
      const stateRoot = state.hashTreeRoot();
      const {state: loadedState, validatorsBytes} = loadStateAndValidators(config, stateBytes);
      expect(loadedState.hashTreeRoot()).toEqual(stateRoot);
      // serialize() somehow takes time, however comparing state root would be enough
      // expect(loadedState.serialize()).toEqual(stateBytes);
      expect(validatorsBytes).toEqual(state.validators.serialize());
    });
  }
});
