import fs from "node:fs";
import path from "node:path";
import {sleep} from "@lodestar/utils";

export enum ProfileThread {
  MAIN = "main",
  NETWORK = "network",
  DISC5 = "discv5",
}

/**
 * The time to take a Bun profile.
 * If we increase this time it'll potentiall cause the app to crash.
 * If we decrease this time, profile recorded will be fragmented and hard to analyze.
 */
const BUN_PROFILE_MS = 3 * 1000;

export async function profileThread(thread: ProfileThread, durationMs: number, dirpath: string): Promise<string> {
  return globalThis.Bun ? profileBun(thread, durationMs) : profileNodeJS(thread, durationMs, dirpath);
}

/**
 * Take `durationMs` profile of the current thread and return the persisted file path.
 */
async function profileNodeJS(thread: ProfileThread, durationMs: number, dirpath: string): Promise<string> {
  const inspector = await import("node:inspector");

  // due to some typing issues, not able to use promisify here
  const profile = await new Promise<string>((resolve, reject) => {
    // Start the inspector and connect to it
    const session = new inspector.Session();
    session.connect();

    session.post("Profiler.enable", () => {
      session.post("Profiler.start", async () => {
        await sleep(durationMs);
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

  const filePath = path.join(dirpath, `${thread}_thread_${new Date().toISOString()}.cpuprofile`);
  fs.writeFileSync(filePath, profile);
  return filePath;
}

/**
 * Unlike NodeJS, Bun console.profile() api flush data to the inspector,
 * so this api returns ms taken of this profile instead of file path.
 */
async function profileBun(thread: ProfileThread, durationMs: number): Promise<string> {
  const start = Date.now();
  let now = Date.now();
  while (now - start < durationMs) {
    // biome-ignore lint/suspicious/noConsole: need to use console api to profile in Bun
    console.profile(String(now));
    await sleep(BUN_PROFILE_MS);
    // biome-ignore lint/suspicious/noConsole: need to use console api to profile in Bun
    console.profileEnd(String(now));
    now = Date.now();
  }

  return `Successfully take Bun ${thread} thread profile in ${now - start}ms. Check your inspector to see the profile.`;
}

/**
 * Write heap snapshot of the current thread to the specified file.
 */
export async function writeHeapSnapshot(prefix: string, dirpath: string): Promise<string> {
  // Lazily import NodeJS only modules
  const fs = await import("node:fs");
  const v8 = await import("node:v8");
  const snapshotStream = v8.getHeapSnapshot();
  const filepath = `${dirpath}/${prefix}_${new Date().toISOString()}.heapsnapshot`;
  const fileStream = fs.createWriteStream(filepath);
  return new Promise<string>((resolve, reject) => {
    fileStream.on("error", (err) => {
      reject(err);
    });

    snapshotStream.pipe(fileStream);
    snapshotStream.on("end", () => {
      resolve(filepath);
    });
  });
}
