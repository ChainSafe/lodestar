import {initBLS} from "@chainsafe/bls";
import {before, after} from "mocha";
import rimraf from "rimraf";
import {tmpDir} from "./constants";

before(async () => {
  await initBLS();
});

after(async () => {
  await new Promise(resolve => rimraf(tmpDir, resolve));
});