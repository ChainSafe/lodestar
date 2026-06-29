import {describe, expect, it, vi} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {Slot} from "@lodestar/types";
import {ForkChoiceStore} from "../../../src/forkChoice/store.js";

describe("ForkChoiceStore", () => {
  const genesisSlot = 0 as Slot;
  const root = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const checkpoint = {epoch: 0, root: fromHexString(root)};
  const justifiedBalances = new Uint16Array([32]);
  const justifiedBalancesGetter = () => justifiedBalances;
  const stateGetter = () => null;

  describe("notifyFastConfirmation", () => {
    it("invokes onFastConfirmation when callback is provided", () => {
      const onFastConfirmation = vi.fn();
      const store = new ForkChoiceStore(
        genesisSlot,
        checkpoint,
        checkpoint,
        justifiedBalances,
        justifiedBalancesGetter,
        stateGetter,
        {
          onJustified: () => {},
          onFinalized: () => {},
          onFastConfirmation,
        }
      );

      store.notifyFastConfirmation({block: root, slot: 42 as Slot, currentSlot: 43 as Slot});

      expect(onFastConfirmation).toHaveBeenCalledTimes(1);
      expect(onFastConfirmation).toHaveBeenCalledWith({block: root, slot: 42, currentSlot: 43});
    });

    it("is a no-op when onFastConfirmation is not provided", () => {
      const store = new ForkChoiceStore(
        genesisSlot,
        checkpoint,
        checkpoint,
        justifiedBalances,
        justifiedBalancesGetter,
        stateGetter,
        {
          onJustified: () => {},
          onFinalized: () => {},
        }
      );

      expect(() => store.notifyFastConfirmation({block: root, slot: 1 as Slot, currentSlot: 2 as Slot})).not.toThrow();
    });

    it("is a no-op when events object is not provided", () => {
      const store = new ForkChoiceStore(
        genesisSlot,
        checkpoint,
        checkpoint,
        justifiedBalances,
        justifiedBalancesGetter,
        stateGetter
      );

      expect(() => store.notifyFastConfirmation({block: root, slot: 1 as Slot, currentSlot: 2 as Slot})).not.toThrow();
    });
  });
});
