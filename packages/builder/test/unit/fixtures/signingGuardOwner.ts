import {BuilderSigningGuard} from "../../../src/services/builderSigningGuard.js";

const guard = await BuilderSigningGuard.acquire(process.argv[2]);
process.on("message", async (message) => {
  if (message === "close") {
    await guard.close();
    process.exit(0);
  }
});
process.send?.("ready");
