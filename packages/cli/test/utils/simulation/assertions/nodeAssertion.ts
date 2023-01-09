import {routes} from "@lodestar/api/beacon";
import type {SecretKey} from "@chainsafe/bls/types";
import {CLClientKeys, SimulationAssertion} from "../interfaces.js";
import {arrayEquals} from "../utils/index.js";
import {neverMatcher} from "./matchers.js";

export const nodeAssertion: SimulationAssertion<"node", string> = {
  id: "node",
  // Include into particular test with custom condition
  match: neverMatcher,
  async assert({nodes}) {
    const errors: string[] = [];

    for (const node of nodes) {
      const health = await node.cl.api.node.getHealth();

      if (health !== routes.node.NodeHealth.SYNCING && health !== routes.node.NodeHealth.READY) {
        errors.push(`node health is neither READY or SYNCING. ${JSON.stringify({id: node.cl.id})}`);
      }
      const keys = getAllKeys(node.cl.keys);

      if (keys.length === 0) {
        continue;
      }

      const keyManagerKeys = (await node.cl.keyManager.listKeys()).data.map((k) => k.validatingPubkey);
      const expectedPubkeys = keys.map((k) => k.toPublicKey().toHex());

      if (!arrayEquals(keyManagerKeys.sort(), expectedPubkeys.sort())) {
        errors.push(
          `Validator should have correct number of keys loaded. ${JSON.stringify({
            id: node.cl.id,
            expectedPubkeys,
            keyManagerKeys,
          })}`
        );
      }
    }

    return errors;
  },
};

function getAllKeys(keys: CLClientKeys): SecretKey[] {
  switch (keys.type) {
    case "local":
      return keys.secretKeys;
    case "remote":
      return keys.secretKeys;
    case "no-keys":
      return [];
  }
}
