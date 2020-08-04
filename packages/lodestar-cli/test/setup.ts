import {initBLS} from "@chainsafe/bls";
import {before, after} from "mocha";
import rimraf from "rimraf";
import {tmpDir} from "./constants";
import { mkdir } from "fs";

before(async () => {
  await initBLS();
  // mkdir("./tmp", () => {});
});

after(async () => {
  await new Promise(resolve => rimraf(tmpDir, resolve));
});