import fs from "node:fs";
import path from "node:path";
import {dirSync as tmpDirSync} from "tmp";
import {ForkSeq} from "@lodestar/params";
import {fetch, retry, withTimeout} from "@lodestar/utils";
import {runDockerContainer} from "./dockercontainer.ts";

const web3signerVersion = "25.11.0";
const web3signerImage = `consensys/web3signer:${web3signerVersion}`;

/** Till what version is the web3signer image updated for signature verification */
const supportedForkSeq = ForkSeq.fulu;

export type StartedExternalSigner = {
  stop: () => void;
  url: string;
  supportedForkSeq: ForkSeq;
};

export async function startExternalSigner({
  keystoreStrings,
  password,
}: {
  keystoreStrings: string[];
  password: string;
}): Promise<StartedExternalSigner> {
  // path to store configuration
  const tmpDir = tmpDirSync({
    unsafeCleanup: true,
    // In Github runner NodeJS process probably runs as root, so web3signer doesn't have permissions to read config dir
    mode: 755,
  });
  // Apply permissions again to hopefully make Github runner happy >.<
  fs.chmodSync(tmpDir.name, 0o755);

  const configDirPathHost = tmpDir.name;
  const configDirPathContainer = "/var/web3signer/config";

  // keystore content and file paths
  const passwordFilename = "password.txt";

  for (const [idx, keystoreString] of keystoreStrings.entries()) {
    fs.writeFileSync(path.join(configDirPathHost, `keystore-${idx}.json`), keystoreString);
  }
  fs.writeFileSync(path.join(configDirPathHost, passwordFilename), password);

  const port = 9090;
  const web3signerUrl = `http://127.0.0.1:${port}`;

  const stop = runDockerContainer(
    web3signerImage,
    [
      // |
      `--publish=${port}:${port}`,
      `--volume=${configDirPathHost}:${configDirPathContainer}`,
    ],
    [
      "--http-listen-host=0.0.0.0",
      `--http-listen-port=${port}`,
      "eth2",
      `--keystores-path=${configDirPathContainer}`,
      // Don't use path.join here, the container is running on unix filesystem
      `--keystores-password-file=${configDirPathContainer}/${passwordFilename}`,
      "--slashing-protection-enabled=false",
    ],
    {pipeToProcess: true}
  );

  await retry(
    () =>
      withTimeout(async (signal) => {
        const res = await fetch(`${web3signerUrl}/healthcheck`, {signal});
        if (res.status !== 200) throw Error(`status ${res.status}`);
      }, 1000),
    {retries: 60, retryDelay: 1000}
  );

  return {
    stop,
    url: web3signerUrl,
    supportedForkSeq,
  };
}
