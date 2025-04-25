import fs from "node:fs";
import path from "node:path";
import {ForkSeq} from "@lodestar/params";
import {GenericContainer, StartedTestContainer, Wait} from "testcontainers";
import {dirSync as tmpDirSync} from "tmp";

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

  const startedContainer = await new GenericContainer(`consensys/web3signer:${web3signerVersion}`)
    .withHealthCheck({
      test: ["CMD-SHELL", "curl -f http://localhost:9000/healthcheck || exit 1"],
      interval: 2000,
      timeout: 5000,
      retries: 10,
      startPeriod: 5000,
    })
    .withWaitStrategy(Wait.forHealthCheck())
    .withExposedPorts(9000) // Internal port is always 9000
    .withBindMounts([{source: configDirPathHost, target: configDirPathContainer, mode: "ro"}])
    .withCommand([
      "eth2",
      `--keystores-path=${configDirPathContainer}`,
      // Don't use path.join here, the container is running on unix filesystem
      `--keystores-password-file=${configDirPathContainer}/${passwordFilename}`,
      "--slashing-protection-enabled=false",
    ])
    .start();

  const url = `http://localhost:${startedContainer.getMappedPort(9000)}`;

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
