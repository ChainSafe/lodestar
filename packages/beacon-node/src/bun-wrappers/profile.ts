import {sleep} from "@lodestar/utils";
import type {ProfileThread} from "../util/profile.js";

/**
 * The time to take a Bun profile.
 * If we increase this time it'll potentiall cause the app to crash.
 * If we decrease this time, profile recorded will be fragmented and hard to analyze.
 */
const BUN_PROFILE_MS = 3 * 1000;

/**
 * Unlike NodeJS, Bun console.profile() api flush data to the inspector,
 * so this api returns ms taken of this profile instead of file path.
 */
export async function profileThread(thread: ProfileThread, durationMs: number): Promise<string> {
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
