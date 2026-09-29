import {describe, expect, it} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {BeaconConfig, createBeaconConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {
  BeaconStateView,
  assertValidAttesterSlashing,
  assertValidProposerSlashing,
  createCachedBeaconState,
  getAttesterSlashingSignatureSets,
  getProposerSlashingSignatureSets,
} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
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

function makeState(slot: number, beaconConfig = config): BeaconStateView {
  const state = beaconConfig.getForkTypes(slot).BeaconState.defaultViewDU();
  state.slot = slot;
  const validators = generateState({}, config, true).validators.getAllReadonlyValues();
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
  return {...chain, bls: new BlsSingleThreadVerifier({metrics: null})};
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

describe.each(forkTransitions)("slashing revalidation: $name", ({beaconConfig}) => {
  it("excludes future-slot proposer evidence that becomes invalid at the fork", async () => {
    const chain = makeChain(makeState(beforeSlot, beaconConfig), beaconConfig);
    const slashing = makeProposerSlashing(afterSlot, beforeSlot, beaconConfig);
    await validateGossipProposerSlashing(chain, slashing);
    const pool = new OpPool(beaconConfig);
    pool.insertProposerSlashing(slashing);

    const after = makeState(afterSlot, beaconConfig);
    expect(() => assertValidProposerSlashing(beaconConfig, after.slot, slashing, after.getValidator(0))).toThrow(
      "ProposerSlashing header1 signature invalid"
    );
    expect(pool.getSlashingsAndExits(after, BlockType.Full, null)[1]).toHaveLength(0);
    expect(pool.proposerSlashingsSize).toBe(0);
    expect(pool.hasSeenProposerSlashing(0)).toBe(false);
  });

  it("excludes future-target attester evidence that becomes invalid at the fork", async () => {
    const chain = makeChain(makeState(beforeSlot, beaconConfig), beaconConfig);
    const slashing = makeAttesterSlashing(1, beforeSlot, beaconConfig);
    await validateGossipAttesterSlashing(chain, slashing);
    const pool = new OpPool(beaconConfig);
    pool.insertAttesterSlashing(beaconConfig.getForkName(beforeSlot), slashing);

    const after = makeState(afterSlot, beaconConfig);
    expect(() =>
      assertValidAttesterSlashing(beaconConfig, after.slot, after.validatorCount, slashing, false)
    ).not.toThrow();
    expect(() => assertValidAttesterSlashing(beaconConfig, after.slot, after.validatorCount, slashing)).toThrow(
      "AttesterSlashing attestation0 is invalid"
    );
    expect(pool.getSlashingsAndExits(after, BlockType.Full, null)[0]).toHaveLength(0);
    expect(pool.attesterSlashingsSize).toBe(0);
    expect(pool.hasSeenAttesterSlashing([0])).toBe(true);
  });

  it("keeps ordinary evidence across the fork", async () => {
    const chain = makeChain(makeState(beforeSlot, beaconConfig), beaconConfig);
    const proposerSlashing = makeProposerSlashing(beforeSlot, beforeSlot, beaconConfig);
    const attesterSlashing = makeAttesterSlashing(0, beforeSlot, beaconConfig, 1);
    await validateGossipProposerSlashing(chain, proposerSlashing);
    await validateGossipAttesterSlashing(chain, attesterSlashing);
    const pool = new OpPool(beaconConfig);
    pool.insertProposerSlashing(proposerSlashing);
    pool.insertAttesterSlashing(beaconConfig.getForkName(beforeSlot), attesterSlashing);

    const [attesterSlashings, proposerSlashings] = pool.getSlashingsAndExits(
      makeState(afterSlot, beaconConfig),
      BlockType.Full,
      null
    );
    expect(proposerSlashings).toEqual([proposerSlashing]);
    expect(attesterSlashings).toEqual([attesterSlashing]);
  });

  it("does not let an invalid proposer slashing exclude a valid attester slashing", async () => {
    const chain = makeChain(makeState(beforeSlot, beaconConfig), beaconConfig);
    const proposerSlashing = makeProposerSlashing(afterSlot, beforeSlot, beaconConfig);
    const attesterSlashing = makeAttesterSlashing(0, beforeSlot, beaconConfig);
    await validateGossipProposerSlashing(chain, proposerSlashing);
    await validateGossipAttesterSlashing(chain, attesterSlashing);
    const pool = new OpPool(beaconConfig);
    pool.insertProposerSlashing(proposerSlashing);
    pool.insertAttesterSlashing(beaconConfig.getForkName(beforeSlot), attesterSlashing);

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
      await validateGossipAttesterSlashing(chain, slashing);
      pool.insertAttesterSlashing(beaconConfig.getForkName(beforeSlot), slashing);
    }

    expect(pool.getSlashingsAndExits(makeState(afterSlot, beaconConfig), BlockType.Full, null)[0]).toEqual([valid]);
  });
});

describe("slashing revalidation", () => {
  it("excludes ordinary evidence after a second fork changes its domain", async () => {
    const chain = makeChain(makeState(beforeSlot));
    const proposerSlashing = makeProposerSlashing(beforeSlot, beforeSlot);
    const attesterSlashing = makeAttesterSlashing(0, beforeSlot, config, 1);
    await validateGossipProposerSlashing(chain, proposerSlashing);
    await validateGossipAttesterSlashing(chain, attesterSlashing);
    const pool = new OpPool(config);
    pool.insertProposerSlashing(proposerSlashing);
    pool.insertAttesterSlashing(config.getForkName(beforeSlot), attesterSlashing);

    const [attesterSlashings, proposerSlashings] = pool.getSlashingsAndExits(
      makeState(2 * SLOTS_PER_EPOCH),
      BlockType.Full,
      null
    );
    expect(proposerSlashings).toHaveLength(0);
    expect(attesterSlashings).toHaveLength(0);
  });

  it("checks both signatures of a surround vote when only the second domain changes", async () => {
    const beaconConfig = createBeaconConfig(
      {...config, ALTAIR_FORK_EPOCH: 3, BELLATRIX_FORK_EPOCH: 6},
      config.genesisValidatorsRoot
    );
    const before = makeState(3 * SLOTS_PER_EPOCH, beaconConfig);
    const chain = makeChain(before, beaconConfig);
    const slashing = makeAttesterSlashing(3, before.slot, beaconConfig, 0, 2);
    await validateGossipAttesterSlashing(chain, slashing);
    const pool = new OpPool(beaconConfig);
    pool.insertAttesterSlashing(beaconConfig.getForkName(before.slot), slashing);
    expect(pool.getSlashingsAndExits(before, BlockType.Full, null)[0]).toEqual([slashing]);

    const after = makeState(6 * SLOTS_PER_EPOCH, beaconConfig);
    const sets = getAttesterSlashingSignatureSets(beaconConfig, after.slot, slashing);
    expect(await chain.bls.verifySignatureSets([sets[0]])).toBe(true);
    expect(await chain.bls.verifySignatureSets([sets[1]])).toBe(false);
    expect(pool.getSlashingsAndExits(after, BlockType.Full, null)[0]).toHaveLength(0);
  });
});

describe("persisted slashings", () => {
  it("revalidates restored evidence at inclusion and removes invalid entries from disk", async () => {
    const before = makeState(beforeSlot);
    const after = makeState(afterSlot);
    const chain = makeChain(before);
    const validProposer = makeProposerSlashing(beforeSlot, beforeSlot);
    const invalidProposer = makeProposerSlashing(afterSlot, beforeSlot, config, 2);
    const validAttester = makeAttesterSlashing(0, beforeSlot, config, 1);
    const invalidAttester = makeAttesterSlashing(1, beforeSlot, config, 3);
    const pool = new OpPool(config);
    for (const slashing of [validProposer, invalidProposer]) {
      await validateGossipProposerSlashing(chain, slashing);
      pool.insertProposerSlashing(slashing);
    }
    for (const slashing of [validAttester, invalidAttester]) {
      await validateGossipAttesterSlashing(chain, slashing);
      pool.insertAttesterSlashing(config.getForkName(beforeSlot), slashing);
    }
    const {db, close} = await startIsolatedTmpBeaconDb(config);
    try {
      await pool.toPersisted(db);
      const restored = new OpPool(config);
      await restored.fromPersisted(db);
      expect(restored.proposerSlashingsSize).toBe(2);
      expect(restored.attesterSlashingsSize).toBe(2);

      const [attesterSlashings, proposerSlashings] = restored.getSlashingsAndExits(after, BlockType.Full, null);
      expect(proposerSlashings).toHaveLength(1);
      expect(attesterSlashings).toHaveLength(1);
      expect(ssz.phase0.ProposerSlashing.equals(proposerSlashings[0], validProposer)).toBe(true);
      expect(ssz.electra.AttesterSlashing.equals(attesterSlashings[0], validAttester)).toBe(true);

      await restored.toPersisted(db);
      expect(await db.proposerSlashing.keys()).toEqual([0]);
      expect(await db.attesterSlashing.values()).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("persists replacement proposer evidence for the same validator", async () => {
    const before = makeState(beforeSlot);
    const after = makeState(afterSlot);
    const chain = makeChain(before);
    const stale = makeProposerSlashing(afterSlot, beforeSlot);
    const replacement = makeProposerSlashing(afterSlot, afterSlot);
    await validateGossipProposerSlashing(chain, stale);
    const pool = new OpPool(config);
    pool.insertProposerSlashing(stale);
    const {db, close} = await startIsolatedTmpBeaconDb(config);
    try {
      await pool.toPersisted(db);
      pool.getSlashingsAndExits(after, BlockType.Full, null);
      chain.getHeadState.mockReturnValue(after);
      await validateGossipProposerSlashing(chain, replacement);
      pool.insertProposerSlashing(replacement);
      await pool.toPersisted(db);

      const restored = new OpPool(config);
      await restored.fromPersisted(db);
      const selected = restored.getSlashingsAndExits(after, BlockType.Full, null)[1];
      expect(selected).toHaveLength(1);
      expect(ssz.phase0.ProposerSlashing.equals(selected[0], replacement)).toBe(true);
    } finally {
      await close();
    }
  });
});
