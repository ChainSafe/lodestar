import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fetch} from "cross-fetch";
import tmp from "tmp";
import {expect} from "chai";
import {Keystore} from "@chainsafe/bls-keystore";
import {fromHex, toHex, withTimeout} from "@lodestar/utils";
import {config} from "@lodestar/config/default";
import {createIBeaconConfig} from "@lodestar/config";
import {genesisData} from "@lodestar/config/networks";
import {getClient} from "@lodestar/api";
import bls from "@chainsafe/bls";
import {Interchange, ISlashingProtection, Signer, SignerType, ValidatorStore} from "../../src/index.js";
import {IndicesService} from "../../src/services/indices.js";
import {testLogger} from "../utils/logger.js";

/* eslint-disable no-console */

describe("web3signer signature test", function () {
  this.timeout("60s");

  const web3signerImage = "consensys/web3signer:22.8.1";
  let validatorStoreRemote: ValidatorStore;
  let validatorStoreLocal: ValidatorStore;
  let proc: child_process.ChildProcessWithoutNullStreams | null;
  let web3signerStdoutErr = "";

  const pubkey = "0x8837af2a7452aff5a8b6906c3e5adefce5690e1bba6d73d870b9e679fece096b97a255bae0978e3a344aa832f68c6b47";
  const pubkeyBytes = fromHex(pubkey);

  after(() => {
    if (proc) {
      proc.kill("SIGKILL");
      try {
        child_process.execSync(`pkill -P ${proc.pid}`);
      } catch (e) {
        //
      }
    }
  });

  before("pull image", function () {
    // allow enough time to pull image
    this.timeout("300s");
    child_process.execSync(`docker pull ${web3signerImage}`);
  });

  beforeDone("start web3signer", async function (done) {
    // docker run -p <listenPort>:9000 consensys/web3signer:develop [options] [subcommand] [options]

    const logPrefix = "web3signer";
    const tmpDir = tmp.dirSync({unsafeCleanup: true});
    const configDirPath = tmpDir.name;
    const passwordFilename = "password.txt";
    const password = "password";
    const keystoreStr = getKeystore();
    const secretKey = bls.SecretKey.fromBytes(await Keystore.parse(keystoreStr).decrypt(password));
    const port = 9000;
    const web3signerUrl = `http://127.0.0.1:${port}`;

    fs.writeFileSync(path.join(configDirPath, "keystore.json"), keystoreStr);
    fs.writeFileSync(path.join(configDirPath, passwordFilename), password);

    proc = child_process.spawn("docker", [
      "run",
      "--rm",
      "--network=host",
      `-v=${configDirPath}:/config`,
      web3signerImage,
      "--http-listen-host=127.0.0.1",
      `--http-listen-port=${port}`,
      "eth2",
      "--slashing-protection-enabled=false",
      // "--key-manager-api-enabled=true",
      "--keystores-path=/config",
      `--keystores-password-file=/config/${passwordFilename}`,
    ]);

    proc.stdout.on("data", (chunk) => {
      web3signerStdoutErr += Buffer.from(chunk).toString("utf8");
    });
    proc.stderr.on("data", (chunk) => {
      web3signerStdoutErr += Buffer.from(chunk).toString("utf8");
    });

    proc.on("exit", (code) => {
      console.log(`${logPrefix} process exited`, {code});
      console.log(web3signerStdoutErr);
      done(Error(`process exited with code ${code}`));
    });

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        // https://consensys.github.io/web3signer/web3signer-eth2.html#tag/Server-Health-Status
        const res = await withTimeout((signal) => fetch(`${web3signerUrl}/healthcheck`, {signal}), 1000);
        if (res.status === 200) {
          break;
        }
      } catch (e) {
        //
      }

      console.log("Waiting for web3signer");
      await new Promise((r) => setTimeout(r, 1000));
    }

    console.log("Web3signer ready");

    validatorStoreRemote = getValidatorStore({type: SignerType.Remote, url: web3signerUrl, pubkey});
    validatorStoreLocal = getValidatorStore({type: SignerType.Local, secretKey});
  });

  async function assertSameSignature<T extends keyof ValidatorStore>(
    method: T,
    ...args: Parameters<ValidatorStore[T]>
  ): Promise<void> {
    const signatureRemote = await (validatorStoreRemote[method] as () => Promise<Buffer>)(...(args as []));
    const signatureLocal = await (validatorStoreLocal[method] as () => Promise<Buffer>)(...(args as []));
    expect(toHex(signatureRemote)).equals(toHex(signatureLocal), `Wrong signature for ${method}`);
  }

  it("signBlock", async () => {
    await assertSameSignature("signBlock", pubkeyBytes);
  });

  it("signRandao", async () => {
    await assertSameSignature("signRandao", pubkeyBytes, 0);
  });

  it("signAttestation", async () => {
    await assertSameSignature("signAttestation", pubkeyBytes);
  });

  it("signAggregateAndProof", async () => {
    await assertSameSignature("signAggregateAndProof", pubkeyBytes);
  });

  it("signSyncCommitteeSignature", async () => {
    await assertSameSignature("signSyncCommitteeSignature", pubkeyBytes);
  });

  it("signContributionAndProof", async () => {
    await assertSameSignature("signContributionAndProof", pubkeyBytes);
  });

  it("signAttestationSelectionProof", async () => {
    await assertSameSignature("signAttestationSelectionProof", pubkeyBytes);
  });

  it("signSyncCommitteeSelectionProof", async () => {
    await assertSameSignature("signSyncCommitteeSelectionProof", pubkeyBytes);
  });

  it("signVoluntaryExit", async () => {
    await assertSameSignature("signVoluntaryExit", pubkeyBytes);
  });

  it("signValidatorRegistration", async () => {
    await assertSameSignature("signValidatorRegistration", pubkeyBytes);
  });
});

function getValidatorStore(signer: Signer): ValidatorStore {
  const logger = testLogger();
  const api = getClient({baseUrl: "http://localhost:9596"}, {config});
  const genesisValidatorsRoot = fromHex(genesisData.mainnet.genesisValidatorsRoot);
  const metrics = null;
  const doppelgangerService = null;
  const valProposerConfig = undefined;
  const indicesService = new IndicesService(logger, api, metrics);
  const slashingProtection = new SlashingProtectionDisabled();
  return new ValidatorStore(
    createIBeaconConfig(config, genesisValidatorsRoot),
    slashingProtection,
    indicesService,
    doppelgangerService,
    metrics,
    [signer],
    valProposerConfig,
    genesisValidatorsRoot
  );
}

class SlashingProtectionDisabled implements ISlashingProtection {
  async checkAndInsertBlockProposal(): Promise<void> {
    //
  }

  async checkAndInsertAttestation(): Promise<void> {
    //
  }

  async importInterchange(): Promise<void> {
    //
  }

  exportInterchange(): Promise<Interchange> {
    throw Error("not implemented");
  }
}

/**
 * Extends Mocha it() to allow BOTH:
 * - Resolve / reject callback promise to end test
 * - Use done() to end test early
 */
export function beforeDone(
  title: string,
  cb: (this: Mocha.Context, done: (err?: Error) => void) => Promise<void>
): void {
  before(title, function () {
    return new Promise<void>((resolve, reject) => {
      function done(err?: Error): void {
        if (err) reject(err);
        else resolve();
      }
      cb.bind(this)(done).then(resolve, reject);
    });
  });
}

function getKeystore(): string {
  return `{
    "version": 4,
    "uuid": "f31f3377-694d-4943-8686-5b20356b2597",
    "path": "m/12381/3600/0/0/0",
    "pubkey": "8837af2a7452aff5a8b6906c3e5adefce5690e1bba6d73d870b9e679fece096b97a255bae0978e3a344aa832f68c6b47",
    "crypto": {
      "kdf": {
        "function": "pbkdf2",
        "params": {
          "dklen": 32,
          "c": 262144,
          "prf": "hmac-sha256",
          "salt": "ab2c11fe1a288a8344972e5e03a746f42867f5a9e749bf286f8e26cf16702c93"
        },
        "message": ""
      },
      "checksum": {
        "function": "sha256",
        "params": {},
        "message": "1f0eda362360b51b85591e99fee6c5d030cc48f36af28eb055b19a2bf55b38a6"
      },
      "cipher": {
        "function": "aes-128-ctr",
        "params": {
          "iv": "acf3173c5d0b074e1646bb6058dc0f2a"
        },
        "message": "402d1cecaa378e4f079c96437bd1d4771e09a85df2073d014b43980b623b9978"
      }
    }
  }`;
}
