import {expect, describe, it, vi, beforeAll, afterAll} from "vitest";
import {fromHex, toHex} from "@lodestar/utils";
import {config} from "@lodestar/config/default";
import {computeStartSlotAtEpoch, interopSecretKey, interopSecretKeys} from "@lodestar/state-transition";
import {createBeaconConfig} from "@lodestar/config";
import {genesisData} from "@lodestar/config/networks";
import {getClient, routes} from "@lodestar/api";
import {ssz, sszTypesFor} from "@lodestar/types";
import {ForkSeq} from "@lodestar/params";
import {getKeystoresStr, StartedExternalSigner, startExternalSigner} from "@lodestar/test-utils";
import {Interchange, ISlashingProtection, Signer, SignerType, ValidatorStore} from "../../src/index.js";
import {IndicesService} from "../../src/services/indices.js";
import {testLogger} from "../utils/logger.js";

describe("web3signer signature test", () => {
  vi.setConfig({testTimeout: 60_000, hookTimeout: 60_000});

  const altairSlot = 2375711;
  const epoch = 0;
  // Sample validator
  const validatorIndex = 4;
  const subcommitteeIndex = 0;

  const secretKey = interopSecretKey(0);
  const pubkeyBytes = secretKey.toPublicKey().toBytes();

  let validatorStoreRemote: ValidatorStore;
  let validatorStoreLocal: ValidatorStore;

  let externalSigner: StartedExternalSigner;

  const duty: routes.validator.AttesterDuty = {
    slot: altairSlot,
    committeeIndex: 0,
    committeeLength: 120,
    committeesAtSlot: 120,
    validatorCommitteeIndex: 0,
    validatorIndex,
    pubkey: pubkeyBytes,
  };

  beforeAll(async () => {
    validatorStoreLocal = await getValidatorStore({type: SignerType.Local, secretKey: secretKey});

    const password = "password";
    externalSigner = await startExternalSigner({
      keystoreStrings: await getKeystoresStr(
        password,
        interopSecretKeys(2).map((k) => k.toHex())
      ),
      password: password,
    });
    validatorStoreRemote = await getValidatorStore({
      type: SignerType.Remote,
      url: externalSigner.url,
      pubkey: secretKey.toPublicKey().toHex(),
    });
  });

  afterAll(async () => {
    await externalSigner.container.stop();
  });

  for (const fork of config.forksAscendingEpochOrder) {
    it(`signBlock ${fork.name}`, async ({skip}) => {
      // Only test till the fork the signer version supports
      if (ForkSeq[fork.name] > externalSigner.supportedForkSeq) {
        skip();
        return;
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

  it("signRandao", async () => {
    await assertSameSignature("signRandao", pubkeyBytes, epoch);
  });

  it("signAttestation", async () => {
    const attestationData = ssz.phase0.AttestationData.defaultValue();
    attestationData.slot = duty.slot;
    attestationData.index = duty.committeeIndex;
    await assertSameSignature("signAttestation", duty, attestationData, epoch);
  });

  for (const fork of config.forksAscendingEpochOrder) {
    it(`signAggregateAndProof ${fork.name}`, async ({skip}) => {
      // Only test till the fork the signer version supports
      if (ForkSeq[fork.name] > externalSigner.supportedForkSeq) {
        skip();
        return;
      }

      const aggregateAndProof = sszTypesFor(fork.name).AggregateAndProof.defaultValue();
      const slot = computeStartSlotAtEpoch(fork.epoch);
      aggregateAndProof.aggregate.data.slot = slot;
      aggregateAndProof.aggregate.data.index = duty.committeeIndex;

      await assertSameSignature(
        "signAggregateAndProof",
        {...duty, slot},
        aggregateAndProof.selectionProof,
        aggregateAndProof.aggregate
      );
    });
  }

  it("signSyncCommitteeSignature", async () => {
    const beaconBlockRoot = ssz.phase0.BeaconBlockHeader.defaultValue().bodyRoot;
    await assertSameSignature("signSyncCommitteeSignature", pubkeyBytes, validatorIndex, altairSlot, beaconBlockRoot);
  });

  it("signContributionAndProof", async () => {
    const contributionAndProof = ssz.altair.ContributionAndProof.defaultValue();
    contributionAndProof.contribution.slot = duty.slot;
    contributionAndProof.contribution.subcommitteeIndex = duty.committeeIndex;

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
    await assertSameSignature("signVoluntaryExit", pubkeyBytes, validatorIndex, epoch);
  });

  // ValidatorRegistration includes a timestamp so it's possible that web3signer instance and local instance
  // sign different messages and this test fails. Disabling unless it can be proven deterministic
  it.skip("signValidatorRegistration", async () => {
    const regAttributes = {
      feeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      gasLimit: 1,
    };
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

  async function getValidatorStore(signer: Signer): Promise<ValidatorStore> {
    const logger = testLogger();
    const api = getClient({baseUrl: "http://localhost:9596"}, {config});
    const genesisValidatorsRoot = fromHex(genesisData.mainnet.genesisValidatorsRoot);
    const metrics = null;
    const doppelgangerService = null;
    const valProposerConfig = undefined;
    const indicesService = new IndicesService(logger, api, metrics);
    const slashingProtection = new SlashingProtectionDisabled();
    return ValidatorStore.init(
      {
        config: createBeaconConfig(config, genesisValidatorsRoot),
        slashingProtection,
        indicesService,
        doppelgangerService,
        metrics,
      },
      [signer],
      valProposerConfig
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

  async hasAttestedInEpoch(): Promise<boolean> {
    return false;
  }

  async importInterchange(): Promise<void> {
    //
  }

  exportInterchange(): Promise<Interchange> {
    throw Error("not implemented");
  }
}
