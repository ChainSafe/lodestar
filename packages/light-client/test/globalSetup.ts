import {initBls} from "../src/utils/index.js";

export async function setup(): Promise<void> {
  await initBls("herumi");
}
export async function teardown(): Promise<void> {}
