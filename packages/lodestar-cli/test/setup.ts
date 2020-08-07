import {initBLS} from "@chainsafe/bls";
import {before, after} from "mocha";
import rimraf from "rimraf";
import {rootDir, passphraseFile} from "./constants";
import bre from "@nomiclabs/buidler";

before(async () => {
  await initBLS();
  bre.run("node");
});

after(async () => {
  await new Promise(resolve => rimraf(rootDir, resolve));
  await new Promise(resolve => rimraf(passphraseFile, resolve));
  process.exit(0);
});