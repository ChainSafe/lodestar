/* eslint-disable no-console */
import {dump} from "wtfnode";

// Consider it a leak if process does not exit within this time
const LEAK_TIMEOUT_MS = 10_000;

function registerLeakDetection(): void {
  const now = Date.now();
  const timeout = now + LEAK_TIMEOUT_MS;
  console.info(`Registering leak detection hooks. now='${new Date(now).toLocaleString()}'`);
  const timer: NodeJS.Timeout = setInterval(detectLeak, 100);

  function detectLeak(): void {
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
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const activeHandles = (process as NodeJS.Process & {_getActiveHandles: () => {fd: number}[]})
        ._getActiveHandles()
        .filter((h) => typeof h.fd !== "number" || h.fd > 2); // Filter out stdio handles

      console.info("Active handles:", activeHandles.length);

      // Allow this timer to be running
      if (activeHandles.length <= 1) {
        console.info("Seems no leak found. Clearing leak detection hooks.");
        clearInterval(timer);
      }
    }
  }
}

export const mochaHooks = {
  async afterAll() {
    registerLeakDetection();
  },
};
