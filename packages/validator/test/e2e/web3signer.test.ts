import fs from "node:fs";
import path from "node:path";
import tmp from "tmp";
import {expect} from "chai";
import {fetch} from "cross-fetch";
import bls from "@chainsafe/bls";
import {fromHex, retry, toHex, withTimeout} from "@lodestar/utils";
import {config} from "@lodestar/config/default";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {createIBeaconConfig} from "@lodestar/config";
import {genesisData} from "@lodestar/config/networks";
import {getClient, routes} from "@lodestar/api";
import {ssz} from "@lodestar/types";
import {FAR_FUTURE_EPOCH} from "@lodestar/params";
import {Interchange, ISlashingProtection, Signer, SignerType, ValidatorStore} from "../../src/index.js";
import {IndicesService} from "../../src/services/indices.js";
import {testLogger} from "../utils/logger.js";
import {runDockerContainer} from "../utils/dockercontainer.js";
import {generateContributionAndProof, generateEmptyAggregateAndProof} from "../utils/eth2Objects.js";

const web3signerVersion = "22.8.1";
const web3signerImage = `consensys/web3signer:${web3signerVersion}`;

/* eslint-disable no-console, @typescript-eslint/naming-convention */

describe("web3signer signature test", function () {
  this.timeout("60s");

  let validatorStoreRemote: ValidatorStore;
  let validatorStoreLocal: ValidatorStore;

  const pubkey = "0x8837af2a7452aff5a8b6906c3e5adefce5690e1bba6d73d870b9e679fece096b97a255bae0978e3a344aa832f68c6b47";
  const secKey = "0x0319ef578236a024b6184760f44c6bbaa7d6f15c50c5e0e9f705a056ce8c954a";
  const pubkeyBytes = fromHex(pubkey);
  // Sample validator
  const validatorIndex = 4;
  const subcommitteeIndex = 1;

  // web3signer requires epochs and slots to match
  const altairSlot = computeStartSlotAtEpoch(config.ALTAIR_FORK_EPOCH);

  // path to store configuration
  const tmpDir = tmp.dirSync({unsafeCleanup: true});
  const configDirPathHost = tmpDir.name;
  const configDirPathContainer = "/var/web3signer/config";
  const passwordFilename = "password.txt";
  const port = 9000;

  before("write keystores", () => {
    const keystoreStr = getKeystore();
    const password = "password";
    fs.writeFileSync(path.join(configDirPathHost, "keystore.json"), keystoreStr);
    fs.writeFileSync(path.join(configDirPathHost, passwordFilename), password);
  });

  runDockerContainer(
    web3signerImage,
    [
      "run",
      "--rm",
      "--network=host",
      `--volume=${configDirPathHost}:${configDirPathContainer}`,
      web3signerImage,
      "eth2",
      `--keystores-path=${configDirPathContainer}`,
      // Don't use path.join here, the container is running on unix filesystem
      `--keystores-password-file=${configDirPathContainer}/${passwordFilename}`,
      "--slashing-protection-enabled=false",
    ],
    {pipeToProcess: true}
  );

  before("start container", async function () {
    const web3signerUrl = `http://127.0.0.1:${port}`;
    const secretKey = bls.SecretKey.fromBytes(fromHex(secKey));

    // http://localhost:9000/api/v1/eth2/sign/0x8837af2a7452aff5a8b6906c3e5adefce5690e1bba6d73d870b9e679fece096b97a255bae0978e3a344aa832f68c6b47
    validatorStoreRemote = getValidatorStore({type: SignerType.Remote, url: web3signerUrl, pubkey});
    validatorStoreLocal = getValidatorStore({type: SignerType.Local, secretKey});

    await retry(
      () =>
        withTimeout(async (signal) => {
          const res = await fetch(`${web3signerUrl}/healthcheck`, {signal});
          if (res.status !== 200) throw Error(`status ${res.status}`);
        }, 1000),
      {retries: 60, retryDelay: 1000}
    );
  });

  for (const fork of config.forksAscendingEpochOrder) {
    it(`signBlock ${fork.name}`, async function () {
      if (fork.epoch === FAR_FUTURE_EPOCH) {
        this.skip();
      }

      const block = ssz[fork.name].BeaconBlock.defaultValue();
      block.slot = computeStartSlotAtEpoch(fork.epoch);

      // Sanity check, in case two forks have the same epoch
      const blockSlotFork = config.getForkName(block.slot);
      if (blockSlotFork !== fork.name) {
        throw Error(`block fork is ${blockSlotFork}`);
      }

      await assertSameSignature("signBlock", pubkeyBytes, block, block.slot);
    });
  }

  it("signRandao", async function () {
    await assertSameSignature("signRandao", pubkeyBytes, 0);
  });

  const committeeIndex = 1;
  const duty: routes.validator.AttesterDuty = {
    slot: 0,
    committeeIndex,
    committeeLength: 120,
    committeesAtSlot: 120,
    validatorCommitteeIndex: 1,
    validatorIndex,
    pubkey: pubkeyBytes,
  };

  it("signAttestation", async () => {
    const attestationData = ssz.phase0.AttestationData.defaultValue();
    attestationData.slot = duty.slot;
    attestationData.index = duty.committeeIndex;
    const currentEpoch = 0;
    await assertSameSignature("signAttestation", duty, attestationData, currentEpoch);
  });

  it("signAggregateAndProof", async () => {
    // committeeIndex must be equal to duty
    const aggregateAndProof = generateEmptyAggregateAndProof();
    aggregateAndProof.aggregate.data.index = committeeIndex;

    await assertSameSignature(
      "signAggregateAndProof",
      duty,
      aggregateAndProof.selectionProof,
      aggregateAndProof.aggregate
    );
  });

  it("signSyncCommitteeSignature", async () => {
    const beaconBlockRoot = ssz.phase0.BeaconBlockHeader.defaultValue().bodyRoot;
    await assertSameSignature("signSyncCommitteeSignature", pubkeyBytes, validatorIndex, altairSlot, beaconBlockRoot);
  });

  it("signContributionAndProof", async () => {
    const contributionAndProof = generateContributionAndProof();
    contributionAndProof.contribution.slot = altairSlot;

    await assertSameSignature(
      "signContributionAndProof",
      duty,
      contributionAndProof.selectionProof,
      contributionAndProof.contribution
    );
  });

  it("signAttestationSelectionProof", async () => {
    await assertSameSignature("signAttestationSelectionProof", pubkeyBytes, altairSlot);
  });

  it("signSyncCommitteeSelectionProof", async () => {
    await assertSameSignature("signSyncCommitteeSelectionProof", pubkeyBytes, altairSlot, subcommitteeIndex);
  });

  it("signVoluntaryExit", async () => {
    const epoch = 0;
    await assertSameSignature("signVoluntaryExit", pubkeyBytes, validatorIndex, epoch);
  });

  it("signValidatorRegistration", async () => {
    const regAttributes = {
      feeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      gasLimit: 1,
    };
    const epoch = 0;
    await assertSameSignature("signValidatorRegistration", pubkeyBytes, regAttributes, epoch);
  });

  async function assertSameSignature<T extends keyof ValidatorStore>(
    method: T,
    ...args: Parameters<ValidatorStore[T]>
  ): Promise<void> {
    type HasSignature = {signature: Buffer};
    type ReturnType = Buffer | HasSignature;
    const signatureRemote = await (validatorStoreRemote[method] as () => Promise<ReturnType>)(...(args as []));
    const signatureLocal = await (validatorStoreLocal[method] as () => Promise<ReturnType>)(...(args as []));
    if ("fill" in signatureRemote && "fill" in signatureLocal) {
      expect(toHex(signatureRemote)).equals(toHex(signatureLocal), `Wrong signature for ${method}`);
    } else {
      expect(toHex((signatureRemote as HasSignature).signature)).equals(
        toHex((signatureLocal as HasSignature).signature),
        `Wrong signature for ${method}`
      );
    }
  }

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
});

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
