import {SimulationAssertion} from "../../interfaces.js";
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

  async assert({slot, store, epoch, nodes}) {
    const errors: string[] = [];

    for (const node of nodes) {
      const inclusionDelay = store[node.cl.id][slot];

      if (inclusionDelay > expectedMaxInclusionDelay) {
        errors.push(
          `node  has has higher inclusion delay. ${JSON.stringify({
            id: node.cl.id,
            slot,
            epoch,
            inclusionDelay,
            expectedMaxInclusionDelay: expectedMaxInclusionDelay,
          })}`
        );
      }
    }
    return errors;
  },
};
