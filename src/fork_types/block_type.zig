/// BlockType indicates whether a block is full or blinded.
pub const BlockType = enum {
    /// A full block with execution payload.
    full,
    /// A blinded block with only an execution payload header.
    blinded,
};
