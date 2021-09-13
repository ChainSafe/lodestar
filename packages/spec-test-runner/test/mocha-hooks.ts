import {init} from "@chainsafe/bls";
import {RootHookObject} from "mocha";

export const mochaHooks: RootHookObject = {
  beforeAll: (done) => {
    init("blst-native")
      .then(() => done())
      .catch((e: Error) => done(e));
  },
};
