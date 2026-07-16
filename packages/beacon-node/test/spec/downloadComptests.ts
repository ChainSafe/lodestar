import {downloadTests} from "@lodestar/spec-test-util/downloadTests";
import {comptestsSpecTests} from "./specTestVersioning.js";

// Note: the release asset also packages non-vector content (tests/core, tests/formats,
// tests/generators) next to tests/minimal — harmless, the spec-test iterator only reads
// tests/<preset>.
await downloadTests(comptestsSpecTests, console.log).catch((e: Error) => {
  console.error(e);
  process.exit(1);
});
