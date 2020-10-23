import {rootDir} from "../constants";
import {before, after} from "mocha";
import rimraf from "rimraf";

before(async () => {
  await new Promise((resolve) => rimraf(rootDir, resolve));
});

after(async () => {
  await new Promise((resolve) => rimraf(rootDir, resolve));
});
