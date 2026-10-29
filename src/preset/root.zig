const std = @import("std");
const testing = std.testing;
const preset_str = @import("build_options").preset;
const c = @import("constants");

pub const preset = @import("./preset.zig").preset;
pub const active_preset = @import("./preset.zig").active_preset;
pub const Preset = @import("./preset.zig").Preset;

// not in use for now, copied from lodestar ts params
// pub const SYNC_COMMITTEE_SUBNET_SIZE = @divFloor(preset.SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT);

// ssz.deneb.BeaconBlockBody.getPathInfo(['blobKzgCommitments',0]).gindex
// the same to ssz-z
pub const KZG_COMMITMENT_GINDEX0 = if (std.mem.eql(u8, preset_str, "minimal")) 1728 else 221184;
pub const KZG_COMMITMENT_SUBTREE_INDEX0 = KZG_COMMITMENT_GINDEX0 - std.math.pow(usize, 2, preset.KZG_COMMITMENT_INCLUSION_PROOF_DEPTH);

// ssz.deneb.BlobSidecars.elementType.fixedSize
pub const BLOBSIDECAR_FIXED_SIZE = if (std.mem.eql(u8, preset_str, "minimal")) 131704 else 131928;

// 128
pub const NUMBER_OF_COLUMNS = (preset.FIELD_ELEMENTS_PER_BLOB * 2) / preset.FIELD_ELEMENTS_PER_CELL;
pub const BYTES_PER_CELL = preset.FIELD_ELEMENTS_PER_CELL * c.BYTES_PER_FIELD_ELEMENT;
pub const CELLS_PER_EXT_BLOB = preset.FIELD_ELEMENTS_PER_EXT_BLOB / preset.FIELD_ELEMENTS_PER_CELL;

// ssz.fulu.BeaconBlockBody.getPathInfo(['blobKzgCommitments']).gindex
pub const KZG_COMMITMENTS_GINDEX = 27;
pub const KZG_COMMITMENTS_SUBTREE_INDEX = KZG_COMMITMENTS_GINDEX - std.math.pow(usize, 2, preset.KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH);

pub const MAX_REQUEST_DATA_COLUMN_SIDECARS = c.MAX_REQUEST_BLOCKS_DENEB * NUMBER_OF_COLUMNS; // 16384
pub const DATA_COLUMN_SIDECAR_SUBNET_COUNT = 128;
pub const NUMBER_OF_CUSTODY_GROUPS = 128;
// Misc

pub const GENESIS_SLOT = 0;
pub const GENESIS_EPOCH = 0;

test {
    testing.refAllDecls(@This());
}
