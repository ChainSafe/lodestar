import fs from "node:fs";
import path from "node:path";
import {dirSync as tmpDirSync} from "tmp";
import {GenericContainer, Wait, StartedTestContainer} from "testcontainers";
import {ForkSeq} from "@lodestar/params";

const web3signerVersion = "24.2.0";

/** Till what version is the web3signer image updated for signature verification */
const supportedForkSeq = ForkSeq.deneb;

export type StartedExternalSigner = {
  container: StartedTestContainer;
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
  const port = 9000;

  const startedContainer = await new GenericContainer(`consensys/web3signer:${web3signerVersion}`)
    .withHealthCheck({
      test: ["CMD-SHELL", `curl -f http://localhost:${port}/healthcheck || exit 1`],
      interval: 1000,
      timeout: 3000,
      retries: 5,
      startPeriod: 1000,
    })
    .withWaitStrategy(Wait.forHealthCheck())
    .withExposedPorts(port)
    .withBindMounts([{source: configDirPathHost, target: configDirPathContainer, mode: "ro"}])
    .withCommand([
      "eth2",
      `--keystores-path=${configDirPathContainer}`,
      // Don't use path.join here, the container is running on unix filesystem
      `--keystores-password-file=${configDirPathContainer}/${passwordFilename}`,
      "--slashing-protection-enabled=false",
    ])
    .start();

  const url = `http://localhost:${startedContainer.getMappedPort(port)}`;

  const stream = await startedContainer.logs();
  stream
    .on("data", (line) => process.stdout.write(line))
    .on("err", (line) => process.stderr.write(line))
    .on("end", () => console.log("Stream closed"));

  return {
    container: startedContainer,
    url: url,
    supportedForkSeq,
  };
}
