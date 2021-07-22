const exitSignals = ["SIGTERM", "SIGINT"] as NodeJS.Signals[];

/**
 * All CLI handlers should register this callback to exit properly and not leave
 * a process hanging forever. Pass a clean function that will be run until the
 * user forcibly kills the process by doing CTRL+C again
 * @param cleanUpFunction
 */
export function onGracefulShutdown(
  cleanUpFunction: () => Promise<void>,
  // eslint-disable-next-line no-console
  logFn: (msg: string) => void = console.log
): void {
  for (const signal of exitSignals) {
    process.once(signal, async function onSignal() {
      logFn("Stopping gracefully, use Ctrl+C again to force process exit");

      process.on(signal, function onSecondSignal() {
        logFn("Forcing process exit");
        process.exit(1);
      });

      await cleanUpFunction();
    });
  }
}
