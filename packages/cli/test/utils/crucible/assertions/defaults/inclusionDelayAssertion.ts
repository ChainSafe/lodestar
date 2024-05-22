import {AssertionResult, SimulationAssertion} from "../../interfaces.js";
import {avg} from "../../utils/index.js";
import {everySlotMatcher} from "../matchers.js";

export const expectedMaxInclusionDelay = 2;

export const inclusionDelayAssertion: SimulationAssertion<"inclusionDelay", number> = {
  id: "inclusionDelay",
  match: everySlotMatcher,
  async capture(input) {
    return avg(
      Array.from(input.block.message.body.attestations).map((att) => input.block.message.slot - att.data.slot)
    );
  },

  async assert({slot, store}) {
    const errors: AssertionResult[] = [];

    const inclusionDelay = store[slot];

    if (inclusionDelay > expectedMaxInclusionDelay) {
      errors.push([
        "node  has has higher inclusion delay.",
        {
          inclusionDelay,
          expectedMaxInclusionDelay: expectedMaxInclusionDelay,
        },
      ]);
    }

    return errors;
  },

  async dump({store, slot, nodes}) {
    /*
     * | Slot | Node 1 | Node 2 |
     * |------|--------|--------|
     * | 1    | 1.0   | 1.0   |
     * | 2    | 0.8   | 0.8   |
     * | 3    | 0.5  | 0.95   |
     */
    const result = [`Slot,${nodes.map((n) => n.beacon.id).join(", ")}`];
    for (let s = 1; s <= slot; s++) {
      result.push(`${s}, ${nodes.map((n) => store[n.beacon.id][s] ?? "-").join(",")}`);
    }
    return {"inclusionDelayAssertion.csv": result.join("\n")};
  },
};
