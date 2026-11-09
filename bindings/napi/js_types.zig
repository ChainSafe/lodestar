const js = @import("zapi:zapi").js;
const napi = @import("zapi:zapi").napi;

pub fn wrap(comptime T: type, value: napi.Value) T {
    return .{ .val = value };
}

pub const Fork = js.Object(struct {
    previousVersion: js.Uint8Array,
    currentVersion: js.Uint8Array,
    epoch: js.Number,
});

pub const Eth1Data = js.Object(struct {
    depositRoot: js.Uint8Array,
    depositCount: js.BigInt,
    blockHash: js.Uint8Array,
});

pub const BeaconBlockHeader = js.Object(struct {
    slot: js.Number,
    proposerIndex: js.Number,
    parentRoot: js.Uint8Array,
    stateRoot: js.Uint8Array,
    bodyRoot: js.Uint8Array,
});

pub const Checkpoint = js.Object(struct {
    epoch: js.Number,
    root: js.Uint8Array,
});

pub const SyncCommittee = js.Object(struct {
    pubkeys: js.Array,
    aggregatePubkey: js.Uint8Array,
});

pub const BlockRewards = js.Object(struct {
    proposerIndex: js.Number,
    total: js.Number,
    attestations: js.Number,
    syncAggregate: js.Number,
    proposerSlashings: js.Number,
    attesterSlashings: js.Number,
});

pub const IndexedSyncCommittee = js.Object(struct {
    validatorIndices: js.Uint32Array,
    validatorIndexMap: js.Value,
});

pub const Validator = js.Object(struct {
    pubkey: js.Uint8Array,
    withdrawalCredentials: js.Uint8Array,
    effectiveBalance: js.Number,
    slashed: js.Boolean,
    activationEligibilityEpoch: js.Number,
    activationEpoch: js.Number,
    exitEpoch: js.Number,
    withdrawableEpoch: js.Number,
});

pub const ProposerRewards = js.Object(struct {
    attestations: js.Number,
    syncAggregate: js.Number,
    slashing: js.Number,
});

pub const SyncCommitteeReward = js.Object(struct {
    validatorIndex: js.Number,
    reward: js.Number,
});

pub const IdealAttestationsReward = js.Object(struct {
    effectiveBalance: js.Number,
    head: js.Number,
    target: js.Number,
    source: js.Number,
    inclusionDelay: js.Number,
    inactivity: js.Number,
});

pub const TotalAttestationsReward = js.Object(struct {
    validatorIndex: js.Number,
    head: js.Number,
    target: js.Number,
    source: js.Number,
    inclusionDelay: js.Number,
    inactivity: js.Number,
});

pub const AttestationsRewards = js.Object(struct {
    idealRewards: js.Array,
    totalRewards: js.Array,
});

pub const MultiProof = js.Object(struct {
    type: js.String,
    leaves: js.Array,
    descriptor: js.Uint8Array,
});

pub const UnrealizedCheckpoints = js.Object(struct {
    justifiedCheckpoint: Checkpoint,
    finalizedCheckpoint: Checkpoint,
});

pub const SyncCommitteeWitness = js.Object(struct {
    witness: js.Array,
    currentSyncCommitteeRoot: js.Uint8Array,
    nextSyncCommitteeRoot: js.Uint8Array,
    // Arrays on Gloas; undefined on earlier forks, whose committees are siblings.
    currentSyncCommitteeBranch: js.Value,
    nextSyncCommitteeBranch: js.Value,
});
