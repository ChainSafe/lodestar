import {setActivePreset, PresetName} from "@lodestar/params/setPreset";

export async function setup(): Promise<void> {
  process.env.NODE_ENV = "test";

  // Set minimal
  if (process.env.LODESTAR_PRESET === undefined) {
    process.env.LODESTAR_PRESET = "minimal";
  }

  // Override FIELD_ELEMENTS_PER_BLOB if its a dev run, mostly to distinguish from
  // spec runs
  if (process.env.LODESTAR_PRESET === "minimal" && process.env.DEV_RUN) {
    setActivePreset(PresetName.minimal, {FIELD_ELEMENTS_PER_BLOB: 4096});
  }
}

export async function teardown(): Promise<void> {
  // if (teardownHappened) throw new Error("teardown called twice");
  // teardownHappened = true;
  // tear it down here
  // await server.close()
  // await sleep(25);
  // const duration = Date.now() - start
  // console.log(`globalTeardown named-exports.js, took ${(duration)}ms`)
  // if (duration > 4000)
  //  throw new Error('error from teardown in globalSetup named-exports.js')
}
