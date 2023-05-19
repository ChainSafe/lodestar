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
};
