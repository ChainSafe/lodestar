const c = @import("root.zig").c;

pub const BlstError = error{
    BadEncoding,
    PointNotOnCurve,
    PointNotInGroup,
    AggrTypeMismatch,
    VerifyFail,
    PkIsInfinity,
    BadScalar,
    MergeError,
    EmptyAggregate,
    TooManyItems,
    InsufficientScratchSpace,
    UnknownError,
};

pub fn errorFromInt(err: c_uint) BlstError!void {
    switch (err) {
        c.BLST_SUCCESS => return,
        c.BLST_BAD_ENCODING => return error.BadEncoding,
        c.BLST_POINT_NOT_ON_CURVE => return error.PointNotOnCurve,
        c.BLST_POINT_NOT_IN_GROUP => return error.PointNotInGroup,
        c.BLST_AGGR_TYPE_MISMATCH => return error.AggrTypeMismatch,
        c.BLST_VERIFY_FAIL => return error.VerifyFail,
        c.BLST_PK_IS_INFINITY => return error.PkIsInfinity,
        c.BLST_BAD_SCALAR => return error.BadScalar,
        else => return error.UnknownError,
    }
}
