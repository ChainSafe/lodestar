import {sleep} from "@lodestar/utils";

const DEFAULT_PROFILE_DURATION = 10 * 60 * 1000;

/**
 * Take 10m profile of the current thread without promise tracking.
 */
export async function profileNodeJS(): Promise<string> {
  const inspector = await import("node:inspector");

  // due to some typing issues, not able to use promisify here
  return new Promise<string>((resolve, reject) => {
    // Start the inspector and connect to it
    const session = new inspector.Session();
    session.connect();

    session.post("Profiler.enable", () => {
      session.post("Profiler.start", async () => {
        await sleep(DEFAULT_PROFILE_DURATION);
        session.post("Profiler.stop", (err, {profile}) => {
          if (!err) {
            resolve(JSON.stringify(profile));
          } else {
            reject(err);
          }

          // Detach from the inspector and close the session
          session.post("Profiler.disable");
          session.disconnect();
        });
      });
    });
  });
}
