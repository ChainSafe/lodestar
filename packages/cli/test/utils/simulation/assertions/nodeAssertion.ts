import {routes} from "@lodestar/api/beacon";
import type {SecretKey} from "@chainsafe/bls/types";
import {ApiError} from "@lodestar/api";
import {AssertionResult, CLClient, CLClientKeys, SimulationAssertion} from "../interfaces.js";
import {arrayEquals} from "../utils/index.js";
import {neverMatcher} from "./matchers.js";

export const nodeAssertion: SimulationAssertion<"node", {health: number; keyManagerKeys: string[]}> = {
  id: "node",
  // Include into particular test with custom condition
  match: neverMatcher,
  capture: async ({node}) => {
    const {status: health} = await node.cl.api.node.getHealth();
    let keyManagerKeys: string[];

    // There is an authentication issue with the lighthouse keymanager client
    if (node.cl.client == CLClient.Lighthouse || getAllKeys(node.cl.keys).length === 0) {
      keyManagerKeys = [];
    } else {
      const res = await node.cl.keyManager.listKeys();
      ApiError.assert(res);
      keyManagerKeys = res.response.data.map((k) => k.validatingPubkey);
    }

    return {health, keyManagerKeys};
  },
  async assert({node, store, slot}) {
    const errors: AssertionResult[] = [];

    // There is an authentication issue with the lighthouse keymanager client
    if (node.cl.client == CLClient.Lighthouse) return errors;

    const {health, keyManagerKeys} = store[slot];

    if (health !== routes.node.NodeHealth.SYNCING && health !== routes.node.NodeHealth.READY) {
      errors.push(["node health is neither READY or SYNCING", {node: node.cl.id}]);
    }

    const expectedPublicKeys = getAllKeys(node.cl.keys).map((k) => k.toPublicKey().toHex());

    if (!arrayEquals(keyManagerKeys.sort(), expectedPublicKeys.sort())) {
      errors.push([
        "Validator should have correct number of keys loaded",
        {
          expectedPublicKeys,
          keyManagerKeys,
        },
      ]);
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
