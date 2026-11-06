import {FastifyInstance, fastify} from "fastify";
import tmp from "tmp";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {ApiError, routes} from "@lodestar/api";
import {ApiClient, SignRequest, SignableMessageType, getClient} from "@lodestar/api/signer";
import {registerRoutes} from "@lodestar/api/signer/server";
import {BeaconConfig, createBeaconConfig, defaultChainConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db/controller/level";
import {getEnvLogger} from "@lodestar/logger/env";
import {PublicKey, Signature, verify} from "@lodestar/native/blst";
import {
  DOMAIN_APPLICATION_BUILDER,
  DOMAIN_BEACON_BUILDER,
  DOMAIN_BEACON_PROPOSER,
  DOMAIN_DEPOSIT,
  ForkName,
  ForkSeq,
  isForkPostBellatrix,
} from "@lodestar/params";
import {
  ZERO_HASH,
  computeDomain,
  computeEpochAtSlot,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  interopSecretKey,
} from "@lodestar/state-transition";
import {Slot, deneb, ssz, sszTypesFor} from "@lodestar/types";
import {fetch, toHex} from "@lodestar/utils";
import {
  ISlashingProtection,
  Interchange,
  MetaDataRepository,
  SignerType,
  SlashingProtection,
  Signer as ValidatorSigner,
  ValidatorStore,
} from "@lodestar/validator";
import {Signer} from "../../src/index.js";

describe("Signer", () => {
  const logger = getEnvLogger();

  const chainConfig = {
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 1,
    BELLATRIX_FORK_EPOCH: 2,
    CAPELLA_FORK_EPOCH: 3,
    DENEB_FORK_EPOCH: 4,
    ELECTRA_FORK_EPOCH: 5,
    FULU_FORK_EPOCH: 6,
    GLOAS_FORK_EPOCH: 7,
    HEZE_FORK_EPOCH: 8,
  };
  const genesisValidatorsRoot = Buffer.alloc(32, 0xdd);
  const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

  const secretKey = interopSecretKey(0);
  const pubkeyBytes = secretKey.toPublicKey().toBytes();
  const pubkeyHex = secretKey.toPublicKey().toHex();
  const otherPubkeyHex = interopSecretKey(1).toPublicKey().toHex();
  const validatorIndex = 4;
  const subcommitteeIndex = 0;

  const tmpDir = tmp.dirSync({unsafeCleanup: true});
  let db: LevelDbController;
  let signer: Signer;
  let server: FastifyInstance;
  let url: string;
  let client: ApiClient;
  let validatorStoreLocal: ValidatorStore;
  let validatorStoreRemote: ValidatorStore;

  beforeAll(async () => {
    db = await LevelDbController.create({name: tmpDir.name}, {logger});
    signer = await Signer.init(
      {
        config,
        slashingProtection: new SlashingProtection(db),
        metadata: new MetaDataRepository(db),
        logger,
        metrics: null,
      },
      {secretKeys: [secretKey, interopSecretKey(1)], genesisValidatorsRoot}
    );

    server = fastify();
    registerRoutes(server, signer);
    url = await server.listen({port: 0, host: "127.0.0.1"});
    client = getClient({baseUrl: url});

    validatorStoreLocal = await getValidatorStore(config, {type: SignerType.Local, secretKey});
    validatorStoreRemote = await getValidatorStore(config, {type: SignerType.Remote, url, pubkey: pubkeyHex});
  });

  afterAll(async () => {
    await server.close();
    await db.close();
    tmpDir.removeCallback();
  });

  it("upcheck", async () => {
    expect((await client.upcheck()).value()).toEqual({status: "OK"});
  });

  it("listPublicKeys", async () => {
    expect((await client.listPublicKeys()).value()).toEqual([pubkeyHex, otherPubkeyHex]);
  });

  describe("produces the same signatures as a local signer", () => {
    for (const fork of config.forksAscendingEpochOrder) {
      const forkName = fork.name;

      it(`signBlock ${fork.name}`, async () => {
        const block = sszTypesFor(fork.name).BeaconBlock.defaultValue();
        block.slot = computeStartSlotAtEpoch(fork.epoch);
        block.proposerIndex = validatorIndex;
        await assertSameSignature("signBlock", pubkeyBytes, block, block.slot);
      });

      if (isForkPostBellatrix(forkName)) {
        it(`signBlock ${fork.name} blinded`, async () => {
          const block = sszTypesFor(forkName).BlindedBeaconBlock.defaultValue();
          block.slot = computeStartSlotAtEpoch(fork.epoch) + 1;
          block.proposerIndex = validatorIndex;
          await assertSameSignature("signBlock", pubkeyBytes, block, block.slot);
        });
      }

      it(`signAggregateAndProof ${fork.name}`, async () => {
        const aggregateAndProof = sszTypesFor(fork.name).AggregateAndProof.defaultValue();
        const slot = computeStartSlotAtEpoch(fork.epoch);
        aggregateAndProof.aggregate.data.slot = slot;
        aggregateAndProof.aggregate.data.index = 0;
        aggregateAndProof.aggregate.data.target.epoch = fork.epoch;

        await assertSameSignature(
          "signAggregateAndProof",
          attesterDuty(slot),
          aggregateAndProof.selectionProof,
          aggregateAndProof.aggregate
        );
      });

      it(`signRandao ${fork.name}`, async () => {
        await assertSameSignature("signRandao", pubkeyBytes, computeStartSlotAtEpoch(fork.epoch));
      });

      it(`signAttestationSelectionProof ${fork.name}`, async () => {
        await assertSameSignature("signAttestationSelectionProof", pubkeyBytes, computeStartSlotAtEpoch(fork.epoch));
      });

      it(`signVoluntaryExit ${fork.name}`, async () => {
        await assertSameSignature("signVoluntaryExit", pubkeyBytes, validatorIndex, fork.epoch);
      });

      if (fork.seq >= ForkSeq.altair) {
        it(`signSyncCommitteeSignature ${fork.name}`, async () => {
          const beaconBlockRoot = Buffer.alloc(32, fork.seq);
          await assertSameSignature(
            "signSyncCommitteeSignature",
            pubkeyBytes,
            validatorIndex,
            computeStartSlotAtEpoch(fork.epoch),
            beaconBlockRoot
          );
        });

        it(`signContributionAndProof ${fork.name}`, async () => {
          const contributionAndProof = ssz.altair.ContributionAndProof.defaultValue();
          contributionAndProof.contribution.slot = computeStartSlotAtEpoch(fork.epoch);
          contributionAndProof.contribution.subcommitteeIndex = subcommitteeIndex;

          await assertSameSignature(
            "signContributionAndProof",
            {pubkey: pubkeyBytes, validatorIndex},
            contributionAndProof.selectionProof,
            contributionAndProof.contribution
          );
        });

        it(`signSyncCommitteeSelectionProof ${fork.name}`, async () => {
          await assertSameSignature(
            "signSyncCommitteeSelectionProof",
            pubkeyBytes,
            computeStartSlotAtEpoch(fork.epoch),
            subcommitteeIndex
          );
        });
      }

      if (fork.seq >= ForkSeq.gloas) {
        it(`signExecutionPayloadEnvelope ${fork.name}`, async () => {
          const slot = computeStartSlotAtEpoch(fork.epoch);
          const envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();
          envelope.payload.slotNumber = slot;

          await assertSameSignature("signExecutionPayloadEnvelope", pubkeyBytes, envelope, slot);
        });

        it(`signPayloadAttestation ${fork.name}`, async () => {
          const slot = computeStartSlotAtEpoch(fork.epoch);
          const data = ssz.gloas.PayloadAttestationData.defaultValue();
          data.slot = slot;

          await assertSameSignature("signPayloadAttestation", {pubkey: pubkeyBytes, validatorIndex, slot}, data, slot);
        });

        it(`signProposerPreferences ${fork.name}`, async () => {
          const slot = computeStartSlotAtEpoch(fork.epoch) + 1;
          const dependentRoot = Buffer.alloc(32, 0xaa);

          await assertSameSignature(
            "signProposerPreferences",
            {pubkey: pubkeyBytes, validatorIndex, slot},
            dependentRoot,
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            30_000_000,
            slot - 1
          );
        });

        it(`signBuilderRequestAuth ${fork.name}`, async () => {
          const slot = computeStartSlotAtEpoch(fork.epoch);
          await assertSameSignature(
            "signBuilderRequestAuth",
            pubkeyBytes,
            Buffer.from("https://builder.example.org"),
            slot
          );
        });
      }

      if (fork.seq >= ForkSeq.heze) {
        it(`signInclusionList ${fork.name}`, async () => {
          const slot = computeStartSlotAtEpoch(fork.epoch);
          const inclusionList = ssz.heze.InclusionList.defaultValue();
          inclusionList.slot = slot;
          inclusionList.validatorIndex = validatorIndex;

          await assertSameSignature(
            "signInclusionList",
            {pubkey: pubkeyBytes, validatorIndex, slot, dependentRoot: ZERO_HASH},
            inclusionList
          );
        });
      }
    }

    it("signAttestation", async () => {
      const slot = computeStartSlotAtEpoch(chainConfig.DENEB_FORK_EPOCH);
      const attestationData = ssz.phase0.AttestationData.defaultValue();
      attestationData.slot = slot;
      attestationData.index = 0;
      attestationData.target.epoch = computeEpochAtSlot(slot);
      await assertSameSignature("signAttestation", attesterDuty(slot), attestationData, attestationData.target.epoch);
    });
  });

  describe("signs messages the validator client does not produce", () => {
    it("DEPOSIT", async () => {
      const deposit = {
        pubkey: pubkeyBytes,
        withdrawalCredentials: Buffer.alloc(32, 1),
        amount: 32_000_000_000,
        genesisForkVersion: config.GENESIS_FORK_VERSION,
      };
      const {signature} = await signDirectly({type: SignableMessageType.DEPOSIT, data: deposit}, false);

      const domain = computeDomain(DOMAIN_DEPOSIT, deposit.genesisForkVersion, ZERO_HASH);
      const signingRoot = computeSigningRoot(
        ssz.phase0.DepositMessage,
        {pubkey: deposit.pubkey, withdrawalCredentials: deposit.withdrawalCredentials, amount: deposit.amount},
        domain
      );
      expect(verify(signingRoot, PublicKey.fromBytes(pubkeyBytes), Signature.fromBytes(signature))).toBe(true);
    });

    it("VALIDATOR_REGISTRATION", async () => {
      const registration = ssz.bellatrix.ValidatorRegistrationV1.defaultValue();
      registration.pubkey = pubkeyBytes;
      const {signature} = await signDirectly(
        {type: SignableMessageType.VALIDATOR_REGISTRATION, data: registration},
        false
      );

      const domain = computeDomain(DOMAIN_APPLICATION_BUILDER, config.GENESIS_FORK_VERSION, ZERO_HASH);
      const signingRoot = computeSigningRoot(ssz.bellatrix.ValidatorRegistrationV1, registration, domain);
      expect(verify(signingRoot, PublicKey.fromBytes(pubkeyBytes), Signature.fromBytes(signature))).toBe(true);
    });

    it("BLOCK", async () => {
      const block = ssz.phase0.BeaconBlock.defaultValue();
      block.slot = 3;
      block.proposerIndex = validatorIndex;
      const {signature} = await signDirectly({type: SignableMessageType.BLOCK, data: block}, true, block.slot);

      const signingRoot = computeSigningRoot(
        ssz.phase0.BeaconBlock,
        block,
        config.getDomain(block.slot, DOMAIN_BEACON_PROPOSER)
      );
      expect(verify(signingRoot, PublicKey.fromBytes(pubkeyBytes), Signature.fromBytes(signature))).toBe(true);
    });

    it("EXECUTION_PAYLOAD_BID", async () => {
      const slot = computeStartSlotAtEpoch(chainConfig.GLOAS_FORK_EPOCH);
      const bid = ssz.gloas.ExecutionPayloadBid.defaultValue();
      bid.slot = slot;
      const {signature} = await signDirectly(
        {type: SignableMessageType.EXECUTION_PAYLOAD_BID, version: ForkName.gloas, data: bid},
        true,
        slot
      );

      const signingRoot = computeSigningRoot(
        ssz.gloas.ExecutionPayloadBid,
        bid,
        config.getDomain(slot, DOMAIN_BEACON_BUILDER)
      );
      expect(verify(signingRoot, PublicKey.fromBytes(pubkeyBytes), Signature.fromBytes(signature))).toBe(true);
    });
  });

  describe("rejects invalid requests", () => {
    it("unknown public key", async () => {
      await expectApiError(client.sign(randaoRequest(1, {pubkey: `0x${"ab".repeat(48)}`})), 404, "not found");
    });

    it("public key identifier is case insensitive and accepts a missing 0x prefix", async () => {
      const expected = (await client.sign(randaoRequest(1))).value();
      const upper = (await client.sign(randaoRequest(1, {pubkey: pubkeyHex.toUpperCase()}))).value();
      const noPrefix = (await client.sign(randaoRequest(1, {pubkey: pubkeyHex.slice(2)}))).value();
      expect(toHex(upper.signature)).toBe(toHex(expected.signature));
      expect(toHex(noPrefix.signature)).toBe(toHex(expected.signature));
    });

    it("signing root mismatch", async () => {
      await expectApiError(
        client.sign(randaoRequest(1, {signingRoot: Buffer.alloc(32, 0x01)})),
        400,
        "does not match signing root"
      );
    });

    it("missing fork_info", async () => {
      await expectApiError(client.sign(randaoRequest(1, {forkInfo: undefined})), 400, "requires fork_info");
    });

    it("genesis validators root different from the slashing protection database", async () => {
      const slot = computeStartSlotAtEpoch(40);
      const forkInfo = signerForkInfo(slot);
      await expectApiError(
        client.sign({
          pubkey: pubkeyHex,
          forkInfo: {...forkInfo, genesisValidatorsRoot: Buffer.alloc(32, 0xee)},
          message: {type: SignableMessageType.ATTESTATION, data: attestation(slot, 39, 40)},
        }),
        400,
        "does not match"
      );
    });
  });

  describe("slashing protection", () => {
    it("rejects a double vote", async () => {
      const slot = computeStartSlotAtEpoch(50);
      await client.sign(attestationRequest(slot, 49, 50, Buffer.alloc(32, 1))).then((res) => res.assertOk());
      await expectApiError(
        client.sign(attestationRequest(slot, 49, 50, Buffer.alloc(32, 2))),
        412,
        "Slashing protection rejected attestation"
      );
    });

    it("rejects a surround vote", async () => {
      await client.sign(attestationRequest(computeStartSlotAtEpoch(70), 60, 70)).then((res) => res.assertOk());
      await expectApiError(
        client.sign(attestationRequest(computeStartSlotAtEpoch(71), 59, 71)),
        412,
        "Slashing protection rejected attestation"
      );
    });

    it("rejects a double block proposal", async () => {
      const slot = computeStartSlotAtEpoch(80);
      const block = ssz.deneb.BeaconBlock.defaultValue();
      block.slot = slot;
      await client.sign(blockRequest(block)).then((res) => res.assertOk());

      block.proposerIndex = 1;
      await expectApiError(client.sign(blockRequest(block)), 412, "Slashing protection rejected block");
    });

    it("rejects a block proposal below an imported interchange", async () => {
      const interchange: Interchange = {
        metadata: {interchange_format_version: "5", genesis_validators_root: toHex(genesisValidatorsRoot)},
        data: [
          {
            pubkey: otherPubkeyHex,
            signed_blocks: [{slot: String(computeStartSlotAtEpoch(100))}],
            signed_attestations: [],
          },
        ],
      };
      await new SlashingProtection(db).importInterchange(interchange, genesisValidatorsRoot, logger);

      const block = ssz.deneb.BeaconBlock.defaultValue();
      block.slot = computeStartSlotAtEpoch(90);
      await expectApiError(
        client.sign({...blockRequest(block), pubkey: otherPubkeyHex}),
        412,
        "Slashing protection rejected block"
      );

      block.slot = computeStartSlotAtEpoch(101);
      (await client.sign({...blockRequest(block), pubkey: otherPubkeyHex})).assertOk();
    });

    it("pins the database to the genesis validators root of the first protected request", async () => {
      const freshTmpDir = tmp.dirSync({unsafeCleanup: true});
      const freshDb = await LevelDbController.create({name: freshTmpDir.name}, {logger});
      const metadata = new MetaDataRepository(freshDb);
      const freshSigner = await Signer.init(
        {config, slashingProtection: new SlashingProtection(freshDb), metadata, logger, metrics: null},
        {secretKeys: [secretKey]}
      );

      const slot = computeStartSlotAtEpoch(10);
      const first = signerForkInfo(slot);
      const other = {...first, genesisValidatorsRoot: Buffer.alloc(32, 0xee)};
      const message = {type: SignableMessageType.ATTESTATION, data: attestation(slot, 9, 10)} as const;

      await freshSigner.sign({pubkey: pubkeyHex, forkInfo: first, message});
      await expect(freshSigner.sign({pubkey: pubkeyHex, forkInfo: other, message})).rejects.toThrow("does not match");
      expect(toHex((await metadata.getGenesisValidatorsRoot()) ?? new Uint8Array())).toBe(toHex(genesisValidatorsRoot));

      await freshDb.close();
      freshTmpDir.removeCallback();
    });
  });

  it("returns the signature as plain text if requested", async () => {
    const request = randaoRequest(2);
    const expected = (await client.sign(request)).value();

    const res = await fetch(`${url}/api/v1/eth2/sign/${pubkeyHex}`, {
      method: "POST",
      headers: {Accept: "text/plain", "Content-Type": "application/json"},
      body: JSON.stringify({
        type: SignableMessageType.RANDAO_REVEAL,
        fork_info: {
          fork: ssz.phase0.Fork.toJson(request.forkInfo?.fork ?? ssz.phase0.Fork.defaultValue()),
          genesis_validators_root: toHex(genesisValidatorsRoot),
        },
        randao_reveal: {epoch: "2"},
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await res.text()).toBe(toHex(expected.signature));
  });

  function attesterDuty(slot: Slot): routes.validator.AttesterDuty {
    return {
      slot,
      committeeIndex: 0,
      committeeLength: 120,
      committeesAtSlot: 120,
      validatorCommitteeIndex: 0,
      validatorIndex,
      pubkey: pubkeyBytes,
    };
  }

  function signerForkInfo(slot: Slot): NonNullable<SignRequest["forkInfo"]> {
    const fork = config.getForkInfo(slot);
    return {
      fork: {previousVersion: fork.prevVersion, currentVersion: fork.version, epoch: computeEpochAtSlot(slot)},
      genesisValidatorsRoot,
    };
  }

  function randaoRequest(epoch: number, overrides: Partial<SignRequest> = {}): SignRequest {
    return {
      pubkey: pubkeyHex,
      forkInfo: signerForkInfo(computeStartSlotAtEpoch(epoch)),
      message: {type: SignableMessageType.RANDAO_REVEAL, data: {epoch}},
      ...overrides,
    };
  }

  function attestation(slot: Slot, sourceEpoch: number, targetEpoch: number, beaconBlockRoot = ZERO_HASH) {
    const data = ssz.phase0.AttestationData.defaultValue();
    data.slot = slot;
    data.beaconBlockRoot = beaconBlockRoot;
    data.source.epoch = sourceEpoch;
    data.target.epoch = targetEpoch;
    return data;
  }

  function attestationRequest(
    slot: Slot,
    sourceEpoch: number,
    targetEpoch: number,
    beaconBlockRoot = ZERO_HASH
  ): SignRequest {
    return {
      pubkey: pubkeyHex,
      forkInfo: signerForkInfo(slot),
      message: {
        type: SignableMessageType.ATTESTATION,
        data: attestation(slot, sourceEpoch, targetEpoch, beaconBlockRoot),
      },
    };
  }

  function blockRequest(block: deneb.BeaconBlock): SignRequest {
    return {
      pubkey: pubkeyHex,
      forkInfo: signerForkInfo(block.slot),
      message: {type: SignableMessageType.BLOCK_V2, version: ForkName.deneb, data: {block}},
    };
  }

  async function signDirectly(
    message: SignRequest["message"],
    withForkInfo: boolean,
    slot = 0
  ): Promise<{signature: Uint8Array}> {
    const res = await client.sign({
      pubkey: pubkeyHex,
      forkInfo: withForkInfo ? signerForkInfo(slot) : undefined,
      message,
    });
    return res.value();
  }

  async function expectApiError(promise: Promise<{error: () => ApiError | null}>, status: number, message: string) {
    const error = (await promise).error();
    expect(error).toBeInstanceOf(ApiError);
    expect(error?.status).toBe(status);
    expect(error?.message).toContain(message);
  }

  async function assertSameSignature<T extends keyof ValidatorStore>(
    method: T,
    ...args: Parameters<ValidatorStore[T]>
  ): Promise<void> {
    type HasSignature = {signature: Uint8Array};
    type ReturnType = Uint8Array | HasSignature;
    const signatureRemote = await (validatorStoreRemote[method] as () => Promise<ReturnType>)(...(args as []));
    const signatureLocal = await (validatorStoreLocal[method] as () => Promise<ReturnType>)(...(args as []));
    const remote = signatureRemote instanceof Uint8Array ? signatureRemote : signatureRemote.signature;
    const local = signatureLocal instanceof Uint8Array ? signatureLocal : signatureLocal.signature;
    expect(toHex(remote)).toBe(toHex(local));
  }

  async function getValidatorStore(config: BeaconConfig, signer: ValidatorSigner): Promise<ValidatorStore> {
    type Modules = Parameters<typeof ValidatorStore.init>[0];
    const indicesService = {
      index2pubkey: new Map(),
      pubkey2index: new Map(),
      indexCount: 0,
      getAllLocalIndices: () => [],
      pollValidatorIndices: async () => [],
      removeForKey: () => false,
    } as unknown as Modules["indicesService"];

    return ValidatorStore.init(
      {
        config,
        slashingProtection: new SlashingProtectionDisabled(),
        indicesService,
        doppelgangerService: null,
        metrics: null,
      },
      [signer]
    );
  }
});

/**
 * The validator stores under test never block a signature, the signer owns the slashing protection
 */
class SlashingProtectionDisabled implements ISlashingProtection {
  async checkAndInsertBlockProposal(): Promise<void> {}

  async checkAndInsertAttestation(): Promise<void> {}

  async hasAttestedInEpoch(): Promise<boolean> {
    return false;
  }

  async importInterchange(): Promise<void> {}

  exportInterchange(): Promise<Interchange> {
    throw Error("not implemented");
  }
}
