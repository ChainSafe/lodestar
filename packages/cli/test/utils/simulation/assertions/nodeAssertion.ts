import {routes} from "@lodestar/api/beacon";
import {SimulationAssertion} from "../interfaces.js";
import {neverMatcher} from "./matchers.js";

export const nodeAssertion: SimulationAssertion<"node", string> = {
  key: "node",
  // Include into particular test with custom condition
  match: neverMatcher,
  async assert({nodes}) {
    const errors: string[] = [];

    for (const node of nodes) {
      const health = await node.cl.api.node.getHealth();

      if (health !== routes.node.NodeHealth.SYNCING && health !== routes.node.NodeHealth.READY) {
        errors.push(`node health is neither READY or SYNCING. ${JSON.stringify({id: node.cl.id})}`);
      }

      const keyManagerKeys = (await node.cl.keyManager.listKeys()).data.map((k) => k.validatingPubkey).sort();
      const existingKeys = [
        ...node.cl.remoteKeys.map((k) => k.toPublicKey().toHex()),
        ...node.cl.localKeys.map((k) => k.toPublicKey().toHex()),
      ].sort();

      if (keyManagerKeys !== existingKeys) {
        errors.push(
          `Validator should have correct number of keys loaded. ${JSON.stringify({
            id: node.cl.id,
            existingKeys,
            keyManagerKeys,
          })}`
        );
      }
    }

    return errors;
  },
};
