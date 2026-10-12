import {describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {BeaconConfig, createBeaconConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {
  BeaconStateView,
  ISignatureSet,
  assertValidAttesterSlashing,
  assertValidProposerSlashing,
  createCachedBeaconState,
  getAttesterSlashingSignatureSets,
  getProposerSlashingSignatureSets,
} from "@lodestar/state-transition";
import {phase0, ssz} from "@lodestar/types";
import {BlsSingleThreadVerifier} from "../../../../src/chain/bls/singleThread.js";
import {BlockType} from "../../../../src/chain/interface.js";
import {OpPool} from "../../../../src/chain/opPools/opPool.js";
import {validateGossipAttesterSlashing} from "../../../../src/chain/validation/attesterSlashing.js";
import {validateGossipProposerSlashing} from "../../../../src/chain/validation/proposerSlashing.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {startIsolatedTmpBeaconDb} from "../../../utils/db.js";
import {generateState} from "../../../utils/state.js";

const config = createBeaconConfig(
  {
    ...chainConfig,
    ALTAIR_FORK_EPOCH: 1,
    BELLATRIX_FORK_EPOCH: 2,
    CAPELLA_FORK_EPOCH: Infinity,
    DENEB_FORK_EPOCH: Infinity,
    ELECTRA_FORK_EPOCH: Infinity,
    FULU_FORK_EPOCH: Infinity,
    GLOAS_FORK_EPOCH: Infinity,
  },
  Buffer.alloc(32)
);
const beforeSlot = SLOTS_PER_EPOCH - 1;
const afterSlot = SLOTS_PER_EPOCH;
const forkTransitions = [
  {name: "phase0 to altair", beaconConfig: config},
  {
    name: "fulu to gloas",
    beaconConfig: createBeaconConfig(
      {
        ...chainConfig,
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: 0,
        GLOAS_FORK_EPOCH: 1,
      },
      Buffer.alloc(32)
    ),
  },
];

function makeState(
  slot: number,
  beaconConfig = config,
  validatorOverrides: Partial<phase0.Validator> = {}
): BeaconStateView {
  const state = beaconConfig.getForkTypes(slot).BeaconState.defaultViewDU();
  state.slot = slot;
  const validators = generateState({}, config, true).validators.getAllReadonlyValues();
  validators[0] = {...validators[0], ...validatorOverrides};
  for (const validator of validators) {
    state.validators.push(ssz.phase0.Validator.toViewDU(validator));
    state.balances.push(validator.effectiveBalance);
    if ("currentSyncCommittee" in state) {
      state.previousEpochParticipation.push(0);
      state.currentEpochParticipation.push(0);
      state.inactivityScores.push(0);
    }
  }
  if ("currentSyncCommittee" in state) {
    const committee = {
      pubkeys: Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) => validators[i % validators.length].pubkey),
      aggregatePubkey: ssz.BLSPubkey.defaultValue(),
    };
    state.currentSyncCommittee = ssz.altair.SyncCommittee.toViewDU(committee);
    state.nextSyncCommittee = ssz.altair.SyncCommittee.toViewDU(committee);
  }
  const fork = beaconConfig.getForkInfo(slot);
  state.fork.currentVersion = fork.version;
  state.fork.previousVersion = beaconConfig.forks[fork.prevForkName].version;
  state.fork.epoch = fork.epoch;
  state.commit();
  return new BeaconStateView(createCachedBeaconState(state, {config: beaconConfig, pubkeyCache}));
}

function makeChain(state: BeaconStateView, beaconConfig: BeaconConfig = config) {
  const chain = getMockedBeaconChain({config: beaconConfig});
  chain.getHeadState.mockReturnValue(state);
  const bls = new BlsSingleThreadVerifier({metrics: null});
  return {
    ...chain,
    bls: {
      ...chain.bls,
      verifySignatureSets: vi.fn((sets: ISignatureSet[]) => bls.verifySignatureSets(sets)),
    },
  };
}

function makeProposerSlashing(headerSlot: number, signingStateSlot: number, beaconConfig = config, validatorIndex = 0) {
  const slashing = ssz.phase0.ProposerSlashing.defaultValue();
  slashing.signedHeader1.message.proposerIndex = validatorIndex;
  slashing.signedHeader2.message.proposerIndex = validatorIndex;
  slashing.signedHeader1.message.slot = BigInt(headerSlot);
  slashing.signedHeader2.message.slot = BigInt(headerSlot);
  slashing.signedHeader2.message.bodyRoot = Buffer.alloc(32, 1);
  const sets = getProposerSlashingSignatureSets(beaconConfig, signingStateSlot, slashing);
  const secretKey = SecretKey.fromBytes(Buffer.alloc(32, validatorIndex + 1));
  slashing.signedHeader1.signature = secretKey.sign(sets[0].signingRoot).toBytes();
  slashing.signedHeader2.signature = secretKey.sign(sets[1].signingRoot).toBytes();
  return slashing;
}

function makeAttesterSlashing(
  targetEpoch: number,
  signingStateSlot: number,
  beaconConfig = config,
  validatorIndex = 0,
  secondTargetEpoch = targetEpoch
) {
  const slashing = ssz.electra.AttesterSlashing.defaultValue();
  slashing.attestation1.attestingIndices = [validatorIndex];
  slashing.attestation2.attestingIndices = [validatorIndex];
  slashing.attestation1.data.target.epoch = BigInt(targetEpoch);
  slashing.attestation2.data.target.epoch = BigInt(secondTargetEpoch);
  if (secondTargetEpoch !== targetEpoch) {
    slashing.attestation2.data.source.epoch = 1n;
  }
  slashing.attestation2.data.beaconBlockRoot = Buffer.alloc(32, 1);
  const sets = getAttesterSlashingSignatureSets(beaconConfig, signingStateSlot, slashing);
  const secretKey = SecretKey.fromBytes(Buffer.alloc(32, validatorIndex + 1));
  slashing.attestation1.signature = secretKey.sign(sets[0].signingRoot).toBytes();
  slashing.attestation2.signature = secretKey.sign(sets[1].signingRoot).toBytes();
  return slashing;
}

describe.each(forkTransitions)("slashing signature domains: $name", ({beaconConfig}) => {
  it("excludes proposer slashings with future-slot headers that become invalid at the fork", async () => {
    const chain = makeChain(makeState(beforeSlot, beaconConfig), beaconConfig);
    const slashing = makeProposerSlashing(afterSlot, beforeSlot, beaconConfig);
    const verifiedDomain = await validateGossipProposerSlashing(chain, slashing);
    const pool = new OpPool(beaconConfig);
    pool.insertProposerSlashing(slashing, verifiedDomain);

    const after = makeState(afterSlot, beaconConfig);
    expect(() => assertValidProposerSlashing(beaconConfig, after.slot, slashing, after.getValidator(0))).toThrow(
      "ProposerSlashing header1 signature invalid"
    );
    expect(pool.getAllProposerSlashings()).toEqual([slashing]);
    expect(pool.getSlashingsAndExits(after, BlockType.Full, null)[1]).toHaveLength(0);
    expect(pool.proposerSlashingsSize).toBe(0);
    expect(pool.hasSeenProposerSlashing(0)).toBe(false);
  });

  it("excludes attester slashings with future target epochs that become invalid at the fork", async () => {
    const chain = makeChain(makeState(beforeSlot, beaconConfig), beaconConfig);
    const slashing = makeAttesterSlashing(1, beforeSlot, beaconConfig);
    const verifiedDomains = await validateGossipAttesterSlashing(chain, slashing);
    const pool = new OpPool(beaconConfig);
    pool.insertAttesterSlashing(beaconConfig.getForkName(beforeSlot), slashing, verifiedDomains);

    const after = makeState(afterSlot, beaconConfig);
    expect(() =>
      assertValidAttesterSlashing(beaconConfig, after.slot, after.validatorCount, slashing, false)
    ).not.toThrow();
    expect(() => assertValidAttesterSlashing(beaconConfig, after.slot, after.validatorCount, slashing)).toThrow(
      "AttesterSlashing attestation0 is invalid"
    );
    expect(pool.getAllAttesterSlashings()).toEqual([slashing]);
    expect(pool.getSlashingsAndExits(after, BlockType.Full, null)[0]).toHaveLength(0);
    expect(pool.attesterSlashingsSize).toBe(0);
    expect(pool.hasSeenAttesterSlashing([0])).toBe(true);
  });

  it("keeps slashings for pre-fork messages across the fork without repeating BLS verification", async () => {
    const chain = makeChain(makeState(beforeSlot, beaconConfig), beaconConfig);
    const proposerSlashing = makeProposerSlashing(beforeSlot, beforeSlot, beaconConfig);
    const attesterSlashing = makeAttesterSlashing(0, beforeSlot, beaconConfig, 1);
    const pool = new OpPool(beaconConfig);
    pool.insertProposerSlashing(proposerSlashing, await validateGossipProposerSlashing(chain, proposerSlashing));
    pool.insertAttesterSlashing(
      beaconConfig.getForkName(beforeSlot),
      attesterSlashing,
      await validateGossipAttesterSlashing(chain, attesterSlashing)
    );
    chain.bls.verifySignatureSets.mockClear();

    const after = makeState(afterSlot, beaconConfig);
    const [attesterSlashings, proposerSlashings] = pool.getSlashingsAndExits(after, BlockType.Full, null);
    expect(proposerSlashings).toEqual([proposerSlashing]);
    expect(attesterSlashings).toEqual([attesterSlashing]);
    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
    expect(() =>
      assertValidProposerSlashing(beaconConfig, after.slot, proposerSlashings[0], after.getValidator(0))
    ).not.toThrow();
    expect(() =>
      assertValidAttesterSlashing(beaconConfig, after.slot, after.validatorCount, attesterSlashings[0])
    ).not.toThrow();
  });

  it("does not let an invalid proposer slashing exclude a valid attester slashing", async () => {
    const chain = makeChain(makeState(beforeSlot, beaconConfig), beaconConfig);
    const proposerSlashing = makeProposerSlashing(afterSlot, beforeSlot, beaconConfig);
    const attesterSlashing = makeAttesterSlashing(0, beforeSlot, beaconConfig);
    const pool = new OpPool(beaconConfig);
    pool.insertProposerSlashing(proposerSlashing, await validateGossipProposerSlashing(chain, proposerSlashing));
    pool.insertAttesterSlashing(
      beaconConfig.getForkName(beforeSlot),
      attesterSlashing,
      await validateGossipAttesterSlashing(chain, attesterSlashing)
    );

    const [attesterSlashings, proposerSlashings] = pool.getSlashingsAndExits(
      makeState(afterSlot, beaconConfig),
      BlockType.Full,
      null
    );
    expect(proposerSlashings).toHaveLength(0);
    expect(attesterSlashings).toEqual([attesterSlashing]);
  });

  it("continues selecting attester slashings after an invalid candidate", async () => {
    const chain = makeChain(makeState(beforeSlot, beaconConfig), beaconConfig);
    const invalid = makeAttesterSlashing(1, beforeSlot, beaconConfig);
    const valid = makeAttesterSlashing(0, beforeSlot, beaconConfig, 1);
    const pool = new OpPool(beaconConfig);
    for (const slashing of [invalid, valid]) {
      pool.insertAttesterSlashing(
        beaconConfig.getForkName(beforeSlot),
        slashing,
        await validateGossipAttesterSlashing(chain, slashing)
      );
    }

    expect(pool.getSlashingsAndExits(makeState(afterSlot, beaconConfig), BlockType.Full, null)[0]).toEqual([valid]);
  });
});

describe("slashing verification context", () => {
  it("excludes slashings for pre-fork messages after a second fork changes their domains", async () => {
    const chain = makeChain(makeState(beforeSlot));
    const proposerSlashing = makeProposerSlashing(beforeSlot, beforeSlot);
    const attesterSlashing = makeAttesterSlashing(0, beforeSlot, config, 1);
    const pool = new OpPool(config);
    pool.insertProposerSlashing(proposerSlashing, await validateGossipProposerSlashing(chain, proposerSlashing));
    pool.insertAttesterSlashing(
      config.getForkName(beforeSlot),
      attesterSlashing,
      await validateGossipAttesterSlashing(chain, attesterSlashing)
    );

    const [attesterSlashings, proposerSlashings] = pool.getSlashingsAndExits(
      makeState(2 * SLOTS_PER_EPOCH),
      BlockType.Full,
      null
    );
    expect(proposerSlashings).toHaveLength(0);
    expect(attesterSlashings).toHaveLength(0);
  });

  it("checks both target epochs of a surround vote when only the second domain changes", async () => {
    const beaconConfig = createBeaconConfig(
      {...config, ALTAIR_FORK_EPOCH: 3, BELLATRIX_FORK_EPOCH: 6},
      config.genesisValidatorsRoot
    );
    const before = makeState(3 * SLOTS_PER_EPOCH, beaconConfig);
    const chain = makeChain(before, beaconConfig);
    const slashing = makeAttesterSlashing(3, before.slot, beaconConfig, 0, 2);
    const verifiedDomains = await validateGossipAttesterSlashing(chain, slashing);
    expect(verifiedDomains[0]).not.toEqual(verifiedDomains[1]);
    const pool = new OpPool(beaconConfig);
    pool.insertAttesterSlashing(beaconConfig.getForkName(before.slot), slashing, verifiedDomains);
    expect(pool.getSlashingsAndExits(before, BlockType.Full, null)[0]).toEqual([slashing]);

    const after = makeState(6 * SLOTS_PER_EPOCH, beaconConfig);
    const bls = new BlsSingleThreadVerifier({metrics: null});
    const sets = getAttesterSlashingSignatureSets(beaconConfig, after.slot, slashing);
    expect(await bls.verifySignatureSets([sets[0]])).toBe(true);
    expect(await bls.verifySignatureSets([sets[1]])).toBe(false);
    expect(pool.getSlashingsAndExits(after, BlockType.Full, null)[0]).toHaveLength(0);
  });

  it.each(["proposer", "attester"] as const)(
    "preserves the %s verification context when the head changes while awaiting BLS",
    async (kind) => {
      const before = makeState(beforeSlot);
      const after = makeState(afterSlot);
      const chain = makeChain(before);
      const bls = new BlsSingleThreadVerifier({metrics: null});
      chain.bls.verifySignatureSets.mockImplementation(async (sets) => {
        const valid = await bls.verifySignatureSets(sets);
        chain.getHeadState.mockReturnValue(after);
        return valid;
      });
      const pool = new OpPool(config);
      const proposerSlashing = makeProposerSlashing(afterSlot, beforeSlot);
      const attesterSlashing = makeAttesterSlashing(1, beforeSlot);
      const validation =
        kind === "proposer"
          ? validateGossipProposerSlashing(chain, proposerSlashing).then((domain) =>
              pool.insertProposerSlashing(proposerSlashing, domain)
            )
          : validateGossipAttesterSlashing(chain, attesterSlashing).then((domains) =>
              pool.insertAttesterSlashing(config.getForkName(beforeSlot), attesterSlashing, domains)
            );
      await validation;

      const [attesterSlashings, proposerSlashings] = pool.getSlashingsAndExits(after, BlockType.Full, null);
      expect(proposerSlashings).toHaveLength(0);
      expect(attesterSlashings).toHaveLength(0);
    }
  );
});

describe("persisted slashings", () => {
  it("restores post-fork slashings when the startup anchor is still pre-fork", async () => {
    const anchor = makeState(beforeSlot);
    const head = makeState(afterSlot);
    const chain = makeChain(head);
    const proposerSlashing = makeProposerSlashing(afterSlot, afterSlot);
    const attesterSlashing = makeAttesterSlashing(1, afterSlot, config, 1);
    const pool = new OpPool(config);
    pool.insertProposerSlashing(proposerSlashing, await validateGossipProposerSlashing(chain, proposerSlashing));
    pool.insertAttesterSlashing(
      config.getForkName(afterSlot),
      attesterSlashing,
      await validateGossipAttesterSlashing(chain, attesterSlashing)
    );
    const {db, close} = await startIsolatedTmpBeaconDb(config);
    try {
      await pool.toPersisted(db);
      const restored = new OpPool(config);
      await restored.fromPersisted(db, anchor, new BlsSingleThreadVerifier({metrics: null}), afterSlot);
      const [attesterSlashings, proposerSlashings] = restored.getSlashingsAndExits(head, BlockType.Full, null);
      expect(proposerSlashings).toHaveLength(1);
      expect(attesterSlashings).toHaveLength(1);
      expect(() =>
        assertValidProposerSlashing(config, head.slot, proposerSlashings[0], head.getValidator(0))
      ).not.toThrow();
      expect(() =>
        assertValidAttesterSlashing(config, head.slot, head.validatorCount, attesterSlashings[0])
      ).not.toThrow();
    } finally {
      await close();
    }
  });

  it("retains proposer slashings when the startup anchor precedes activation", async () => {
    const activationEpoch = 6;
    const head = makeState(activationEpoch * SLOTS_PER_EPOCH, config, {activationEpoch});
    const anchor = makeState((activationEpoch - 1) * SLOTS_PER_EPOCH, config, {activationEpoch});
    const chain = makeChain(head);
    const slashing = makeProposerSlashing(head.slot, head.slot);
    const pool = new OpPool(config);
    pool.insertProposerSlashing(slashing, await validateGossipProposerSlashing(chain, slashing));
    const {db, close} = await startIsolatedTmpBeaconDb(config);
    try {
      await pool.toPersisted(db);
      const bls = new BlsSingleThreadVerifier({metrics: null});
      expect(await bls.verifySignatureSets(getProposerSlashingSignatureSets(config, anchor.slot, slashing))).toBe(true);
      const restored = new OpPool(config);
      await restored.fromPersisted(db, anchor, bls, head.slot);
      expect(restored.proposerSlashingsSize).toBe(1);
      expect(restored.getSlashingsAndExits(anchor, BlockType.Full, null)[1]).toHaveLength(0);
      const selected = restored.getSlashingsAndExits(head, BlockType.Full, null)[1];
      expect(selected).toHaveLength(1);
      expect(() => assertValidProposerSlashing(config, head.slot, selected[0], head.getValidator(0))).not.toThrow();
    } finally {
      await close();
    }
  });

  it("retains proposer slashings when the restoring state marks the proposer slashed", async () => {
    const unslashed = makeState(beforeSlot);
    const slashed = makeState(beforeSlot, config, {slashed: true});
    const chain = makeChain(unslashed);
    const slashing = makeProposerSlashing(beforeSlot, beforeSlot);
    const pool = new OpPool(config);
    pool.insertProposerSlashing(slashing, await validateGossipProposerSlashing(chain, slashing));
    const {db, close} = await startIsolatedTmpBeaconDb(config);
    try {
      await pool.toPersisted(db);
      const restored = new OpPool(config);
      await restored.fromPersisted(db, slashed, new BlsSingleThreadVerifier({metrics: null}), slashed.slot);
      expect(restored.proposerSlashingsSize).toBe(1);
      expect(restored.getSlashingsAndExits(slashed, BlockType.Full, null)[1]).toHaveLength(0);
      const selected = restored.getSlashingsAndExits(unslashed, BlockType.Full, null)[1];
      expect(selected).toHaveLength(1);
      expect(() =>
        assertValidProposerSlashing(config, unslashed.slot, selected[0], unslashed.getValidator(0))
      ).not.toThrow();
    } finally {
      await close();
    }
  });

  it("persists a replacement proposer slashing for the same validator", async () => {
    const before = makeState(beforeSlot);
    const after = makeState(afterSlot);
    const chain = makeChain(before);
    const stale = makeProposerSlashing(afterSlot, beforeSlot);
    const replacement = makeProposerSlashing(afterSlot, afterSlot);
    const pool = new OpPool(config);
    pool.insertProposerSlashing(stale, await validateGossipProposerSlashing(chain, stale));
    const {db, close} = await startIsolatedTmpBeaconDb(config);
    try {
      await pool.toPersisted(db);
      pool.getSlashingsAndExits(after, BlockType.Full, null);
      chain.getHeadState.mockReturnValue(after);
      pool.insertProposerSlashing(replacement, await validateGossipProposerSlashing(chain, replacement));
      await pool.toPersisted(db);

      const restored = new OpPool(config);
      await restored.fromPersisted(db, after, new BlsSingleThreadVerifier({metrics: null}), after.slot);
      const selected = restored.getSlashingsAndExits(after, BlockType.Full, null)[1];
      expect(selected).toHaveLength(1);
      expect(ssz.phase0.ProposerSlashing.equals(selected[0], replacement)).toBe(true);
    } finally {
      await close();
    }
  });

  it.each([
    {anchorSlot: beforeSlot, currentSlot: beforeSlot},
    {anchorSlot: afterSlot, currentSlot: afterSlot},
    {anchorSlot: beforeSlot, currentSlot: afterSlot},
  ])(
    "revalidates on reload from slot $anchorSlot at slot $currentSlot and removes invalid slashings from disk",
    async ({anchorSlot, currentSlot}) => {
      const chain = makeChain(makeState(beforeSlot));
      const pool = new OpPool(config);
      const validProposer = makeProposerSlashing(beforeSlot, beforeSlot);
      const invalidProposer = makeProposerSlashing(afterSlot, beforeSlot, config, 2);
      const validAttester = makeAttesterSlashing(0, beforeSlot, config, 1);
      const invalidAttester = makeAttesterSlashing(1, beforeSlot, config, 3);
      for (const slashing of [validProposer, invalidProposer]) {
        pool.insertProposerSlashing(slashing, await validateGossipProposerSlashing(chain, slashing));
      }
      for (const slashing of [validAttester, invalidAttester]) {
        pool.insertAttesterSlashing(
          config.getForkName(beforeSlot),
          slashing,
          await validateGossipAttesterSlashing(chain, slashing)
        );
      }
      const {db, close} = await startIsolatedTmpBeaconDb(config);
      try {
        await pool.toPersisted(db);
        const bls = new BlsSingleThreadVerifier({metrics: null});
        const verify = vi.spyOn(bls, "verifySignatureSets");
        const restored = new OpPool(config);
        await restored.fromPersisted(db, makeState(anchorSlot), bls, currentSlot);
        expect(verify).toHaveBeenCalledTimes(4);
        verify.mockClear();

        const after = makeState(afterSlot);
        const [attesterSlashings, proposerSlashings] = restored.getSlashingsAndExits(after, BlockType.Full, null);
        expect(proposerSlashings).toHaveLength(1);
        expect(attesterSlashings).toHaveLength(1);
        expect(ssz.phase0.ProposerSlashing.equals(proposerSlashings[0], validProposer)).toBe(true);
        expect(ssz.electra.AttesterSlashing.equals(attesterSlashings[0], validAttester)).toBe(true);
        expect(verify).not.toHaveBeenCalled();
        expect(() =>
          assertValidProposerSlashing(config, after.slot, proposerSlashings[0], after.getValidator(0))
        ).not.toThrow();
        expect(() =>
          assertValidAttesterSlashing(config, after.slot, after.validatorCount, attesterSlashings[0])
        ).not.toThrow();

        await restored.toPersisted(db);
        expect(await db.proposerSlashing.keys()).toEqual([0]);
        expect(await db.attesterSlashing.values()).toHaveLength(1);
      } finally {
        await close();
      }
    }
  );

  it.each(["mismatched slots", "mismatched indices", "identical headers", "unknown proposer", "invalid signature"])(
    "discards persisted slashings with %s without marking them seen",
    async (invalidReason) => {
      const invalidProposer = makeProposerSlashing(beforeSlot, beforeSlot);
      const state = makeState(beforeSlot);
      switch (invalidReason) {
        case "mismatched slots":
          invalidProposer.signedHeader2.message.slot++;
          break;
        case "mismatched indices":
          invalidProposer.signedHeader2.message.proposerIndex++;
          break;
        case "identical headers":
          invalidProposer.signedHeader2.message = structuredClone(invalidProposer.signedHeader1.message);
          break;
        case "unknown proposer":
          invalidProposer.signedHeader1.message.proposerIndex = state.validatorCount;
          invalidProposer.signedHeader2.message.proposerIndex = state.validatorCount;
          break;
        case "invalid signature":
          invalidProposer.signedHeader1.signature.fill(0);
          break;
      }
      const invalidAttester = makeAttesterSlashing(0, beforeSlot);
      invalidAttester.attestation1.attestingIndices = [];
      const {db, close} = await startIsolatedTmpBeaconDb(config);
      try {
        await db.proposerSlashing.add(invalidProposer);
        await db.attesterSlashing.add(invalidAttester);
        const pool = new OpPool(config);
        const bls = new BlsSingleThreadVerifier({metrics: null});
        const verify = vi.spyOn(bls, "verifySignatureSets");
        await pool.fromPersisted(db, state, bls, state.slot);
        expect(verify).toHaveBeenCalledTimes(invalidReason === "invalid signature" ? 1 : 0);
        expect(pool.proposerSlashingsSize).toBe(0);
        expect(pool.attesterSlashingsSize).toBe(0);
        expect(pool.hasSeenProposerSlashing(invalidProposer.signedHeader1.message.proposerIndex)).toBe(false);
        expect(pool.hasSeenAttesterSlashing([0])).toBe(false);
      } finally {
        await close();
      }
    }
  );
});
