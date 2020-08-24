const exitSignals = ["SIGTERM", "SIGINT"] as NodeJS.Signals[];

/**
 * All CLI handlers should register this callback to exit properly and not leave
 * a process hanging forever. Pass a clean function that will be run until the
 * user forcibly kills the process by doing CTRL+C again
 * @param cleanUpFunction
 */
export function onProcessSIGINT(cleanUpFunction: () => Promise<void>): void {
  for (const signal of exitSignals) {
    process.once(signal, async () => {
      // eslint-disable-next-line no-console
      console.log("Stopping gracefully, use Ctrl+C again to force process exit");
      process.on(signal, () => {
        // eslint-disable-next-line no-console
        console.log("Forcing process exit");
        process.exit(1);
      });
      await cleanUpFunction();
    });
  }
}
