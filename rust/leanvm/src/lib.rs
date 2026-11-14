//! leanVM's leanXMSS signatures and their aggregation, as the C functions `src/leanvm/root.zig`
//! declares. That file states each function's contract and is the only caller.

#![allow(clippy::missing_safety_doc)]

use std::alloc::{GlobalAlloc, Layout};

use leanvm::lean_xmss::{self, LeanXmssPublicKey, LeanXmssSecretKey, LeanXmssSignature};
use leanvm::{AggregateVerifyError, AggregationError, EthereumClaims, EthereumProof};

unsafe extern "C" {
    fn lodestar_leanvm_alloc(size: usize, align: usize) -> *mut u8;
    fn lodestar_leanvm_free(ptr: *mut u8, size: usize, align: usize);
}

/// `src/leanvm/allocator.zig`, which says why leanVM gets its own.
struct ZigAllocator;

unsafe impl GlobalAlloc for ZigAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        unsafe { lodestar_leanvm_alloc(layout.size(), layout.align()) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { lodestar_leanvm_free(ptr, layout.size(), layout.align()) }
    }
}

#[global_allocator]
static ALLOCATOR: ZigAllocator = ZigAllocator;

// `root.zig` repeats these sizes and limits, so a leanVM that changes one must not build.
const _: () = {
    assert!(lean_xmss::SEED_LEN == 32);
    assert!(lean_xmss::MESSAGE_LEN == 32);
    assert!(lean_xmss::PUB_KEY_SIZE == 32);
    assert!(lean_xmss::SIG_SIZE == 2404);
    assert!(leanvm::MAX_RECURSIONS == 16);
    assert!(leanvm::MAX_KEYS == 1 << 16);
    assert!(leanvm::MIN_LOG_INV_RATE == 1);
    assert!(leanvm::MAX_LOG_INV_RATE == 4);
};

const OK: i32 = 0;
const ERR_SIGN: i32 = 1;
const ERR_INVALID_SIGNATURE: i32 = 2;
const ERR_MALFORMED_SIGNER_SET: i32 = 3;
const ERR_MALFORMED_CLAIM: i32 = 4;
const ERR_MALFORMED_ENCODING: i32 = 5;
const ERR_SNARK: i32 = 6;
const ERR_INVALID_CHILD: i32 = 7;
const ERR_EMPTY: i32 = 8;
const ERR_NOT_COVERED: i32 = 9;
const ERR_MALFORMED_RAW_SIGNATURE: i32 = 10;
const ERR_TOO_LARGE: i32 = 11;
const ERR_INVALID_RATE: i32 = 12;
const ERR_CHILD_OUT_OF_RANGE: i32 = 13;
const ERR_PROVE: i32 = 14;
/// A LeanDA error. No blobs go in, so `root.zig` has no name for it.
const ERR_DA: i32 = 15;

#[repr(C)]
pub struct Claim {
    public_key: [u8; lean_xmss::PUB_KEY_SIZE],
    message: [u8; lean_xmss::MESSAGE_LEN],
}

#[repr(C)]
pub struct Signed {
    public_key: [u8; lean_xmss::PUB_KEY_SIZE],
    message: [u8; lean_xmss::MESSAGE_LEN],
    signature: [u8; lean_xmss::SIG_SIZE],
}

pub struct SecretKey(LeanXmssSecretKey);
pub struct Proof(EthereumProof);

/// `root.zig` lets handles be shared across threads.
const _: () = {
    const fn shared<T: Send + Sync>() {}
    shared::<SecretKey>();
    shared::<Proof>();
};

type Status = Result<(), i32>;

/// Lets a function body use `?`.
fn status(f: impl FnOnce() -> Status) -> i32 {
    match f() {
        Ok(()) => OK,
        Err(status) => status,
    }
}

/// An empty slice may come with any pointer.
unsafe fn slice<'a, T>(ptr: *const T, len: usize) -> &'a [T] {
    if len == 0 {
        return &[];
    }
    unsafe { std::slice::from_raw_parts(ptr, len) }
}

fn boxed<T>(value: T) -> *mut T {
    Box::into_raw(Box::new(value))
}

fn claims_of(claims: &[Claim]) -> EthereumClaims {
    EthereumClaims {
        xmss: claims
            .iter()
            .map(|claim| (LeanXmssPublicKey::from_bytes(&claim.public_key), claim.message))
            .collect(),
        lean_sphincs: Vec::new(),
        da_commitment: None,
    }
}

fn verify_status(error: AggregateVerifyError) -> i32 {
    match error {
        AggregateVerifyError::MalformedSignerSet => ERR_MALFORMED_SIGNER_SET,
        AggregateVerifyError::MalformedClaim => ERR_MALFORMED_CLAIM,
        AggregateVerifyError::MalformedEncoding => ERR_MALFORMED_ENCODING,
        AggregateVerifyError::Snark(_) => ERR_SNARK,
    }
}

fn aggregation_status(error: AggregationError) -> i32 {
    match error {
        AggregationError::InvalidChild(_) => ERR_INVALID_CHILD,
        AggregationError::Empty => ERR_EMPTY,
        AggregationError::NotCovered => ERR_NOT_COVERED,
        AggregationError::MalformedRawSignature => ERR_MALFORMED_RAW_SIGNATURE,
        AggregationError::TooLarge => ERR_TOO_LARGE,
        AggregationError::InvalidRate { .. } => ERR_INVALID_RATE,
        AggregationError::ChildOutOfRange { .. } => ERR_CHILD_OUT_OF_RANGE,
        AggregationError::ProofError(_) => ERR_PROVE,
        AggregationError::InvalidBlobSize { .. }
        | AggregationError::BlobNotCovered
        | AggregationError::BlobsUnpublished => ERR_DA,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn leanvm_setup() {
    leanvm::setup();
}

#[unsafe(no_mangle)]
pub extern "C" fn leanvm_xmss_key_gen() -> *mut SecretKey {
    let (key, _) = lean_xmss::key_gen();
    boxed(SecretKey(key))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_xmss_key_gen_from_seed(seed: *const [u8; lean_xmss::SEED_LEN]) -> *mut SecretKey {
    boxed(SecretKey(LeanXmssSecretKey::from_bytes(unsafe { &*seed })))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_xmss_secret_key_free(key: *mut SecretKey) {
    drop(unsafe { Box::from_raw(key) });
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_xmss_secret_key_seed(key: *const SecretKey, out_seed: *mut [u8; lean_xmss::SEED_LEN]) {
    unsafe { out_seed.write((*key).0.to_bytes()) };
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_xmss_secret_key_public_key(
    key: *const SecretKey,
    out_public_key: *mut [u8; lean_xmss::PUB_KEY_SIZE],
) {
    unsafe { out_public_key.write((*key).0.public_key().to_bytes()) };
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_xmss_secret_key_prepare(key: *const SecretKey, leaf_index: u32) -> i32 {
    status(|| unsafe { &*key }.0.prepare(leaf_index).map_err(|_| ERR_SIGN))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_xmss_sign(
    key: *const SecretKey,
    message: *const [u8; lean_xmss::MESSAGE_LEN],
    leaf_index: u32,
    out_signature: *mut [u8; lean_xmss::SIG_SIZE],
) -> i32 {
    status(|| {
        let (key, message) = unsafe { (&*key, &*message) };
        let signature = lean_xmss::sign(&key.0, message, leaf_index).map_err(|_| ERR_SIGN)?;
        unsafe { out_signature.write(signature.to_bytes()) };
        Ok(())
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_xmss_verify(
    public_key: *const [u8; lean_xmss::PUB_KEY_SIZE],
    message: *const [u8; lean_xmss::MESSAGE_LEN],
    signature: *const [u8; lean_xmss::SIG_SIZE],
) -> i32 {
    let (public_key, message, signature) = unsafe { (&*public_key, &*message, &*signature) };
    let public_key = LeanXmssPublicKey::from_bytes(public_key);
    let signature = LeanXmssSignature::from_bytes(signature);
    status(|| lean_xmss::verify(&public_key, message, &signature).map_err(|_| ERR_INVALID_SIGNATURE))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_aggregate(
    children: *const *const Proof,
    children_len: usize,
    signed: *const Signed,
    signed_len: usize,
    declare: *const Claim,
    declare_len: usize,
    has_declare: bool,
    log_inv_rate: u32,
    out_proof: *mut *mut Proof,
) -> i32 {
    status(|| {
        // `aggregate` takes a slice of proofs, not of pointers to them.
        let children: Vec<_> = unsafe { slice(children, children_len) }
            .iter()
            .map(|&child| unsafe { &*child }.0.clone())
            .collect();
        let signed = unsafe { slice(signed, signed_len) }
            .iter()
            .map(|signed| {
                (
                    LeanXmssPublicKey::from_bytes(&signed.public_key),
                    signed.message,
                    LeanXmssSignature::from_bytes(&signed.signature),
                )
            })
            .collect();
        let declare = has_declare.then(|| claims_of(unsafe { slice(declare, declare_len) }));
        let proof = leanvm::aggregate(
            &children,
            signed,
            Vec::new(),
            &[],
            declare.as_ref(),
            log_inv_rate as usize,
        )
        .map_err(aggregation_status)?;
        unsafe { out_proof.write(boxed(Proof(proof))) };
        Ok(())
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_proof_from_bytes(
    bytes: *const u8,
    bytes_len: usize,
    claims: *const Claim,
    claims_len: usize,
    out_proof: *mut *mut Proof,
) -> i32 {
    status(|| {
        let (bytes, claims) = unsafe { (slice(bytes, bytes_len), slice(claims, claims_len)) };
        let proof = EthereumProof::from_proof_bytes(bytes, claims_of(claims)).map_err(verify_status)?;
        unsafe { out_proof.write(boxed(Proof(proof))) };
        Ok(())
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_proof_free(proof: *mut Proof) {
    drop(unsafe { Box::from_raw(proof) });
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_proof_verify(proof: *const Proof) -> i32 {
    status(|| unsafe { &*proof }.0.verify().map_err(verify_status))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_proof_to_bytes(proof: *const Proof, out_bytes: *mut *mut u8, out_len: *mut usize) {
    let bytes = unsafe { &*proof }.0.proof_bytes().into_boxed_slice();
    unsafe {
        out_len.write(bytes.len());
        out_bytes.write(Box::into_raw(bytes).cast());
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_bytes_free(bytes: *mut u8, len: usize) {
    drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(bytes, len)) });
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_proof_claims_len(proof: *const Proof) -> usize {
    unsafe { &*proof }.0.claims().xmss.len()
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_proof_claims(proof: *const Proof, out_claims: *mut Claim) {
    for (i, (public_key, message)) in unsafe { &*proof }.0.claims().xmss.iter().enumerate() {
        let claim = Claim {
            public_key: public_key.to_bytes(),
            message: *message,
        };
        unsafe { out_claims.add(i).write(claim) };
    }
}
