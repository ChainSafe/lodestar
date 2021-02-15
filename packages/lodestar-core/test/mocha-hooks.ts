import {init} from "@chainsafe/bls";
import {RootHookObject} from "mocha";

export const mochaHooks: RootHookObject = {
  beforeAll: () => [
    async function () {
      try {
        await init("blst-native");
      } catch (e) {
        console.log(e);
      }
    },
  ],
};
