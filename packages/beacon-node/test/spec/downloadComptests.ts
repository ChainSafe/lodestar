import {downloadTests} from "@lodestar/spec-test-util/downloadTests";
import {comptestsSpecTests} from "./specTestVersioning.js";

await downloadTests(comptestsSpecTests, console.log).catch((e: Error) => {
  console.error(e);
  process.exit(1);
});
