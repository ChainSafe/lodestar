/* eslint-disable no-console */
/* eslint-disable import/no-extraneous-dependencies */
import Mocha from "mocha";
import runCommand from "mocha/lib/cli/run.js";
import collectFiles from "mocha/lib/cli/collect-files.js";
import {dump} from "wtfnode";

// Consider it a leak if process does not exit within this time
const LEAK_TIMEOUT_MS = 10_000;

// Code is typically the number of failures
async function exitScenarioHandler(code) {
  const now = Date.now();
  const timeout = now + LEAK_TIMEOUT_MS;
  console.info(`Leak detection after mocha finishes. code=${code} now='${new Date(now).toLocaleString()}'`);
  const timer = setInterval(detectLeak, 100);

  function detectLeak() {
    const now = Date.now();
    console.info(
      `Detecting resource leaks. now='${new Date(now).toLocaleString()}' timeout='${new Date(
        timeout
      ).toLocaleString()}'`
    );

    if (now > timeout) {
      clearInterval(timer);

      console.error("Process did not terminate, dumping remaining handles and exiting");
      dump();

      process.removeAllListeners("exit");
      process.exit(-1);
    } else {
      const activeHandles = process._getActiveHandles().filter((h) => typeof h.fd !== "number" || h.fd > 2); // Filter out stdio handles

      console.info("Active handles:", activeHandles.length);

      // Allow this timer to be running
      if (activeHandles.length <= 1) {
        console.info("Seems no leak found. Clearing leak detection hooks.");
        clearInterval(timer);
      }
    }
  }
}

async function wrappedRunHandler(argv) {
  const mocha = new Mocha(argv);

  const {extension = [], ignore = [], file = [], recursive = false, sort = false, spec = []} = argv;

  const fileCollectParams = {
    ignore,
    extension,
    file,
    recursive,
    sort,
    spec,
  };

  const files = collectFiles(fileCollectParams);
  console.info("single run with %d file(s)", files.length);
  mocha.files = files;

  await mocha.loadFilesAsync();
  mocha.run(exitScenarioHandler);
}

export default {
  ...runCommand,
  handler: wrappedRunHandler,
};
