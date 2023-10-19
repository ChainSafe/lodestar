import type {SecretKey} from "@chainsafe/bls/types";
import {routes} from "@lodestar/api/beacon";
import {ApiError} from "@lodestar/api";
import {AssertionResult, ValidatorClientKeys, SimulationAssertion, ValidatorClient} from "../interfaces.js";
import {arrayEquals} from "../utils/index.js";
import {neverMatcher} from "./matchers.js";

export const nodeAssertion: SimulationAssertion<"node", {health: number; keyManagerKeys: string[]}> = {
  id: "node",
  // Include into particular test with custom condition
  match: neverMatcher,
  capture: async ({node}) => {
    const {status: health} = await node.beacon.api.node.getHealth();
    if (!node.validator) {
      return {health, keyManagerKeys: []};
    }

    let keyManagerKeys: string[];
    // There is an authentication issue with the lighthouse keymanager client
    if (node.validator.client == ValidatorClient.Lighthouse || getAllKeys(node.validator.keys).length === 0) {
      keyManagerKeys = [];
    } else {
      const res = await node.validator.keyManager.listKeys();
      ApiError.assert(res);
      keyManagerKeys = res.response.data.map((k) => k.validatingPubkey);
    }

    return {health, keyManagerKeys};
  },
  async assert({node, store, slot}) {
    const errors: AssertionResult[] = [];

    // There is an authentication issue with the lighthouse keymanager client
    if (node.validator?.client == ValidatorClient.Lighthouse) return errors;

    const {health, keyManagerKeys} = store[slot];

    if (health !== routes.node.NodeHealth.SYNCING && health !== routes.node.NodeHealth.READY) {
      errors.push(["node health is neither READY or SYNCING", {node: node.beacon.id}]);
    }

    const expectedPublicKeys = node.validator
      ? getAllKeys(node.validator.keys).map((k) => k.toPublicKey().toHex())
      : [];

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

function getAllKeys(keys: ValidatorClientKeys): SecretKey[] {
  switch (keys.type) {
    case "local":
      return keys.secretKeys;
    case "remote":
      return keys.secretKeys;
    case "no-keys":
      return [];
  }
}
