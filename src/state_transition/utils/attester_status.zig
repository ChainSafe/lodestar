const c = @import("constants");
const TIMELY_HEAD_FLAG_INDEX = c.TIMELY_HEAD_FLAG_INDEX;
const TIMELY_SOURCE_FLAG_INDEX = c.TIMELY_SOURCE_FLAG_INDEX;
const TIMELY_TARGET_FLAG_INDEX = c.TIMELY_TARGET_FLAG_INDEX;

// We pack both previous and current epoch attester flags
// as well as slashed and eligibility flags into a single number
// to save space in our epoch transition cache.
// Note: the order of the flags is important for efficiently translating
// from the BeaconState flags to our flags.
// [prevSource, prevTarget, prevHead, currSource, currTarget, currHead, unslashed, eligible]
pub const FLAG_PREV_SOURCE_ATTESTER = 1 << TIMELY_SOURCE_FLAG_INDEX;
pub const FLAG_PREV_TARGET_ATTESTER = 1 << TIMELY_TARGET_FLAG_INDEX;
pub const FLAG_PREV_HEAD_ATTESTER = 1 << TIMELY_HEAD_FLAG_INDEX;

pub const FLAG_CURR_SOURCE_ATTESTER = 1 << (3 + TIMELY_SOURCE_FLAG_INDEX);
pub const FLAG_CURR_TARGET_ATTESTER = 1 << (3 + TIMELY_TARGET_FLAG_INDEX);
pub const FLAG_CURR_HEAD_ATTESTER = 1 << (3 + TIMELY_HEAD_FLAG_INDEX);

pub const FLAG_UNSLASHED = 1 << 6;
pub const FLAG_ELIGIBLE_ATTESTER = 1 << 7;

// Precompute OR flags used in epoch processing
pub const FLAG_PREV_SOURCE_ATTESTER_UNSLASHED = FLAG_PREV_SOURCE_ATTESTER | FLAG_UNSLASHED;
pub const FLAG_PREV_TARGET_ATTESTER_UNSLASHED = FLAG_PREV_TARGET_ATTESTER | FLAG_UNSLASHED;
pub const FLAG_PREV_HEAD_ATTESTER_UNSLASHED = FLAG_PREV_HEAD_ATTESTER | FLAG_UNSLASHED;

pub fn hasMarkers(flags: u8, markers: u8) bool {
    return (flags & markers) == markers;
}

// TODOs: implement missing functions
