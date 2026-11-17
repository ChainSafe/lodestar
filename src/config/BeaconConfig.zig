///! Runtime beacon-chain configuration derived from a `ChainConfig`.
const std = @import("std");
const preset = @import("preset").preset;
const ct = @import("consensus_types");
const ForkData = ct.phase0.ForkData.Type;
const Epoch = ct.primitive.Epoch.Type;
const Slot = ct.primitive.Slot.Type;
const Version = ct.primitive.Version.Type;
const Root = ct.primitive.Root.Type;
const DomainType = ct.primitive.DomainType.Type;
const c = @import("constants");
const DOMAIN_VOLUNTARY_EXIT = c.DOMAIN_VOLUNTARY_EXIT;
const ALL_DOMAINS = c.ALL_DOMAINS;
const ForkSeq = @import("./fork_seq.zig").ForkSeq;
const ChainConfig = @import("./ChainConfig.zig");

const BeaconConfig = @This();

chain: ChainConfig,
forks_ascending_epoch_order: [ForkSeq.count]ForkInfo,
forks_descending_epoch_order: [ForkSeq.count]ForkInfo,
genesis_validator_root: Root,
domain_cache: DomainCache,

/// Fork metadata describing one entry in the network’s fork schedule.
///
/// This is similar to `config/fork.zig`'s `ForkInfo`, but scoped to the derived
/// schedule held by `BeaconConfig`.
pub const ForkInfo = struct {
    /// The fork identifier.
    fork_seq: ForkSeq,
    /// The activation epoch for this fork.
    epoch: Epoch,
    /// The fork version active at/after `epoch`.
    version: Version,
    /// The version immediately preceding this fork.
    prev_version: Version,
    /// The fork identifier immediately preceding this fork.
    prev_fork_seq: ForkSeq,
};

/// Domain cache with precomputed domain values for all forks and all domain types.
///
/// Implementation note: uses a fixed-size 2D array for simplicity and performance.
pub const DomainCache = struct {
    inner: [ForkSeq.count][ALL_DOMAINS.len][32]u8,

    /// Precompute all domains for all forks and domain types.
    pub fn init(forks_ascending_epoch_order: [ForkSeq.count]ForkInfo, genesis_validators_root: [32]u8) DomainCache {
        @setEvalBranchQuota(2_000_000);
        var domain_cache = DomainCache{
            .inner = undefined,
        };
        for (&domain_cache.inner, 0..) |*fork_cache, fork_seq| {
            for (fork_cache, 0..) |*domain_entry, domain_index| {
                computeDomain(
                    ALL_DOMAINS[domain_index],
                    forks_ascending_epoch_order[fork_seq].version,
                    genesis_validators_root,
                    domain_entry,
                );
            }
        }
        return domain_cache;
    }

    /// Lookup a precomputed domain by fork and domain type.
    pub fn get(self: *const DomainCache, fork_seq: ForkSeq, domain_type: DomainType) !*const [32]u8 {
        inline for (ALL_DOMAINS, 0..) |d, i| {
            if (std.mem.eql(u8, &d, &domain_type)) {
                return &self.inner[@intFromEnum(fork_seq)][i];
            }
        }
        return error.DomainTypeNotFound;
    }
};

/// Build a `BeaconConfig` from the given chain configuration and genesis validators root.
pub fn init(chain_config: ChainConfig, genesis_validator_root: Root) BeaconConfig {
    const phase0 = ForkInfo{
        .fork_seq = ForkSeq.phase0,
        .epoch = 0,
        .version = chain_config.GENESIS_FORK_VERSION,
        .prev_version = [4]u8{ 0, 0, 0, 0 },
        .prev_fork_seq = ForkSeq.phase0,
    };

    const altair = ForkInfo{
        .fork_seq = ForkSeq.altair,
        .epoch = chain_config.ALTAIR_FORK_EPOCH,
        .version = chain_config.ALTAIR_FORK_VERSION,
        .prev_version = chain_config.GENESIS_FORK_VERSION,
        .prev_fork_seq = ForkSeq.phase0,
    };

    const bellatrix = ForkInfo{
        .fork_seq = ForkSeq.bellatrix,
        .epoch = chain_config.BELLATRIX_FORK_EPOCH,
        .version = chain_config.BELLATRIX_FORK_VERSION,
        .prev_version = chain_config.ALTAIR_FORK_VERSION,
        .prev_fork_seq = ForkSeq.altair,
    };

    const capella = ForkInfo{
        .fork_seq = ForkSeq.capella,
        .epoch = chain_config.CAPELLA_FORK_EPOCH,
        .version = chain_config.CAPELLA_FORK_VERSION,
        .prev_version = chain_config.BELLATRIX_FORK_VERSION,
        .prev_fork_seq = ForkSeq.bellatrix,
    };

    const deneb = ForkInfo{
        .fork_seq = ForkSeq.deneb,
        .epoch = chain_config.DENEB_FORK_EPOCH,
        .version = chain_config.DENEB_FORK_VERSION,
        .prev_version = chain_config.CAPELLA_FORK_VERSION,
        .prev_fork_seq = ForkSeq.capella,
    };

    const electra = ForkInfo{
        .fork_seq = ForkSeq.electra,
        .epoch = chain_config.ELECTRA_FORK_EPOCH,
        .version = chain_config.ELECTRA_FORK_VERSION,
        .prev_version = chain_config.DENEB_FORK_VERSION,
        .prev_fork_seq = ForkSeq.deneb,
    };

    const fulu = ForkInfo{
        .fork_seq = ForkSeq.fulu,
        .epoch = chain_config.FULU_FORK_EPOCH,
        .version = chain_config.FULU_FORK_VERSION,
        .prev_version = chain_config.ELECTRA_FORK_VERSION,
        .prev_fork_seq = ForkSeq.electra,
    };

    const gloas = ForkInfo{
        .fork_seq = ForkSeq.gloas,
        .epoch = chain_config.GLOAS_FORK_EPOCH,
        .version = chain_config.GLOAS_FORK_VERSION,
        .prev_version = chain_config.FULU_FORK_VERSION,
        .prev_fork_seq = ForkSeq.fulu,
    };

    const heze = ForkInfo{
        .fork_seq = .heze,
        .epoch = chain_config.HEZE_FORK_EPOCH,
        .version = chain_config.HEZE_FORK_VERSION,
        .prev_version = chain_config.GLOAS_FORK_VERSION,
        .prev_fork_seq = .gloas,
    };

    const forks_ascending_epoch_order = [ForkSeq.count]ForkInfo{
        phase0,
        altair,
        bellatrix,
        capella,
        deneb,
        electra,
        fulu,
        gloas,
        heze,
    };
    const forks_descending_epoch_order = [ForkSeq.count]ForkInfo{
        heze,
        gloas,
        fulu,
        electra,
        deneb,
        capella,
        bellatrix,
        altair,
        phase0,
    };

    return .{
        .chain = chain_config,
        .forks_ascending_epoch_order = forks_ascending_epoch_order,
        .forks_descending_epoch_order = forks_descending_epoch_order,
        .genesis_validator_root = genesis_validator_root,
        .domain_cache = DomainCache.init(
            forks_ascending_epoch_order,
            genesis_validator_root,
        ),
    };
}

/// Return the active `ForkInfo` for the given slot.
pub fn forkInfo(self: *const BeaconConfig, slot: Slot) *const ForkInfo {
    const epoch = @divFloor(slot, preset.SLOTS_PER_EPOCH);
    return self.forkInfoAtEpoch(epoch);
}

/// Return the active `ForkInfo` for the given epoch.
pub fn forkInfoAtEpoch(self: *const BeaconConfig, epoch: Epoch) *const ForkInfo {
    // NOTE: forks must be sorted by descending epoch, latest fork first
    for (&self.forks_descending_epoch_order) |*fork| {
        if (epoch >= fork.epoch) {
            return fork;
        }
    }

    // phase0
    return &self.forks_ascending_epoch_order[@intFromEnum(ForkSeq.phase0)];
}

/// Return the active fork sequence for `slot`.
pub fn forkSeq(self: *const BeaconConfig, slot: Slot) ForkSeq {
    return self.forkInfo(slot).fork_seq;
}

/// Return the active fork sequence for `epoch`.
pub fn forkSeqAtEpoch(self: *const BeaconConfig, epoch: Epoch) ForkSeq {
    return self.forkInfoAtEpoch(epoch).fork_seq;
}

/// Return the active fork version for `slot`.
pub fn forkVersion(self: *const BeaconConfig, slot: Slot) *const [4]u8 {
    return &self.forkInfo(slot).version;
}

// TODO: is forkTypes() necessary?
// TODO: getPostBellatrixForkTypes
// TODO: getPostAltairForkTypes
// TODO: getPostDenebForkTypes

/// Return the maximum number of blobs allowed per block at `epoch`.
///
/// Fulu introduced Blob Parameter Only (BPO) hard forks [EIP-7892] to adjust the max blobs per block,
/// so the max blobs per block from that fork onwards differ depending on which epoch the hard forks happen.
///
/// Reference: https://eips.ethereum.org/EIPS/eip-7892
pub fn getMaxBlobsPerBlock(self: *const BeaconConfig, epoch: Epoch) u64 {
    const fork = self.forkInfoAtEpoch(epoch).fork_seq;
    return switch (fork) {
        .deneb => self.chain.MAX_BLOBS_PER_BLOCK,
        .electra => self.chain.MAX_BLOBS_PER_BLOCK_ELECTRA,
        .fulu, .gloas, .heze => {
            for (0..self.chain.BLOB_SCHEDULE.len) |i| {
                const schedule = self.chain.BLOB_SCHEDULE[self.chain.BLOB_SCHEDULE.len - i - 1];
                if (epoch >= schedule.EPOCH) return schedule.MAX_BLOBS_PER_BLOCK;
            }
            return self.chain.MAX_BLOBS_PER_BLOCK_ELECTRA;
        },
        else =>
        // For forks before Deneb, we assume no blobs
        0,
    };
}

/// Return the maximum number of blob sidecars that may be requested for the given fork.
pub fn getMaxRequestBlobSidecars(self: *const BeaconConfig, fork: ForkSeq) u64 {
    return if (fork.gte(.electra)) self.chain.MAX_REQUEST_BLOB_SIDECARS_ELECTRA else self.chain.MAX_REQUEST_BLOB_SIDECARS;
}

/// Convert basis points to milliseconds into the slot.
///
/// Integer rounding via `(x + 5000) / 10000`.
pub fn getSlotComponentDurationMs(self: *const BeaconConfig, fork: ForkSeq, basis_points: u64) u64 {
    return (basis_points * self.getSlotDurationMs(fork) + 5000) / 10000;
}

/// Return the proposer reorg cutoff in milliseconds.
pub fn getProposerReorgCutoffMs(self: *const BeaconConfig, fork: ForkSeq) u64 {
    return self.getSlotComponentDurationMs(fork, self.chain.PROPOSER_REORG_CUTOFF_BPS);
}

/// Return the attestation due time in milliseconds for the given fork.
///
/// Pre-Gloas uses `ATTESTATION_DUE_BPS`; Gloas+ uses `ATTESTATION_DUE_BPS_GLOAS`
/// (shorter window to accommodate the ePBS payload reveal phase).
pub fn getAttestationDueMs(self: *const BeaconConfig, fork: ForkSeq) u64 {
    if (fork.gte(.gloas)) {
        return self.getSlotComponentDurationMs(fork, self.chain.ATTESTATION_DUE_BPS_GLOAS);
    }
    return self.getSlotComponentDurationMs(fork, self.chain.ATTESTATION_DUE_BPS);
}

pub fn getSlotDurationMs(self: *const BeaconConfig, fork: ForkSeq) u64 {
    return if (fork.gte(.heze)) self.chain.SLOT_DURATION_MS_HEZE else self.chain.SLOT_DURATION_MS;
}

pub fn getInclusionListDueMs(self: *const BeaconConfig, fork: ForkSeq) u64 {
    return self.getSlotComponentDurationMs(fork, self.chain.INCLUSION_LIST_DUE_BPS);
}

/// Compute the signature domain for a message.
///
/// - `state_slot` is the slot of the state used for verification.
/// - `message_slot` is the slot the message pertains to (if `null`, uses `state_slot`).
///
/// When the message epoch is before the state's active fork epoch, the domain is computed
/// using the previous fork sequence (per spec rules around fork boundaries).
pub fn getDomain(self: *const BeaconConfig, state_epoch: Epoch, domain_type: DomainType, message_slot: ?Slot) !*const [32]u8 {
    const epoch = if (message_slot) |s| @divFloor(s, preset.SLOTS_PER_EPOCH) else state_epoch;
    const state_fork_info = self.forkInfoAtEpoch(state_epoch);
    const fork_seq = if (epoch < state_fork_info.epoch) state_fork_info.prev_fork_seq else state_fork_info.fork_seq;

    return self.domain_cache.get(fork_seq, domain_type);
}

pub fn getDomainForVoluntaryExit(self: *const BeaconConfig, state_epoch: Epoch, message_slot: ?Slot) !*const [32]u8 {
    if (state_epoch < self.chain.DENEB_FORK_EPOCH) {
        return self.getDomain(state_epoch, DOMAIN_VOLUNTARY_EXIT, message_slot);
    } else {
        return self.domain_cache.get(.capella, DOMAIN_VOLUNTARY_EXIT);
    }
}

// TODO: forkDigest2ForkName, forkDigest2ForkNameOption, forkName2ForkDigest, forkName2ForkDigestHex
// may not need it for state-transition

fn computeDomain(domain_type: DomainType, fork_version: Version, genesis_validators_root: Root, out: *[32]u8) void {
    var fork_data_root: [32]u8 = undefined;
    computeForkDataRoot(fork_version, genesis_validators_root, &fork_data_root);
    // 4 first bytes is domain_type
    @memcpy(out[0..4], domain_type[0..4]);
    // 28 next bytes is first 28 bytes of fork_data_root
    @memcpy(out[4..32], fork_data_root[0..28]);
}

fn computeForkDataRoot(current_version: Version, genesis_validators_root: Root, out: *[32]u8) void {
    const fork_data: ForkData = .{
        .current_version = current_version,
        .genesis_validators_root = genesis_validators_root,
    };
    ct.phase0.ForkData.hashTreeRoot(&fork_data, out) catch unreachable;
}

test {
    _ = @import("beacon_config_test.zig");
}
