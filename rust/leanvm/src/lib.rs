//! leanVM's leanXMSS signatures and their aggregation, as the C functions `src/leanvm/root.zig`
//! declares. That file states each function's contract and is the only caller.

#![allow(clippy::missing_safety_doc)]

use std::alloc::{GlobalAlloc, Layout};

use lean_vm::lean_xmss::{self, LeanXmssExpandedSecretKey, LeanXmssPublicKey, LeanXmssSignature};
use lean_vm::{AggregateClaims, AggregateError, AggregateProof, OutputClaims};

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
    assert!(lean_xmss::SECRET_KEY_LEN == 32);
    assert!(lean_xmss::MESSAGE_LEN == 32);
    assert!(lean_xmss::PUB_KEY_SIZE == 32);
    assert!(lean_xmss::SIG_SIZE == 2404);
    assert!(lean_xmss::MAX_CACHED_BOTTOM_TREES == 8);
    assert!(lean_vm::MAX_RECURSIONS == 16);
    assert!(lean_vm::MIN_LOG_INV_RATE == 1);
    assert!(lean_vm::MAX_LOG_INV_RATE == 4);
};

const OK: i32 = 0;
const ERR_INVALID_SIGNATURE: i32 = 1;
const ERR_MALFORMED_ENCODING: i32 = 2;
const ERR_INVALID_PROOF: i32 = 3;
const ERR_INVALID_INPUT: i32 = 4;
const ERR_INVALID_CHILD: i32 = 5;
const ERR_PROVE: i32 = 6;

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

pub struct SecretKey {
    seed: lean_xmss::SecretKey,
    expanded: LeanXmssExpandedSecretKey,
}

/// A proof with the claims it is for, which leanVM keeps apart.
pub struct Proof {
    claims: AggregateClaims,
    proof: AggregateProof,
}

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

fn claims_of(claims: &[Claim]) -> AggregateClaims {
    AggregateClaims {
        lean_xmss: claims
            .iter()
            .map(|claim| (LeanXmssPublicKey::from_bytes(&claim.public_key), claim.message))
            .collect(),
        lean_sphincs: Vec::new(),
        da_commitment: None,
    }
}

fn aggregate_status(error: AggregateError) -> i32 {
    match error {
        AggregateError::InvalidInput(_) => ERR_INVALID_INPUT,
        AggregateError::InvalidSignature => ERR_INVALID_SIGNATURE,
        AggregateError::InvalidChild => ERR_INVALID_CHILD,
        AggregateError::ProvingFailed => ERR_PROVE,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn leanvm_setup() {
    // One thread per core.
    lean_vm::setup(0);
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_xmss_key_gen(seed: *const lean_xmss::SecretKey) -> *mut SecretKey {
    let seed = unsafe { *seed };
    let (expanded, _) = lean_xmss::key_gen(&seed);
    boxed(SecretKey { seed, expanded })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_xmss_secret_key_free(key: *mut SecretKey) {
    drop(unsafe { Box::from_raw(key) });
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_xmss_secret_key_seed(key: *const SecretKey, out_seed: *mut lean_xmss::SecretKey) {
    unsafe { out_seed.write((*key).seed) };
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_xmss_secret_key_public_key(
    key: *const SecretKey,
    out_public_key: *mut [u8; lean_xmss::PUB_KEY_SIZE],
) {
    unsafe { out_public_key.write((*key).expanded.public_key().to_bytes()) };
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_xmss_secret_key_prepare(key: *const SecretKey, leaf_index: u32) {
    unsafe { &*key }.expanded.prepare(leaf_index);
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_xmss_sign(
    key: *const SecretKey,
    message: *const [u8; lean_xmss::MESSAGE_LEN],
    leaf_index: u32,
    out_signature: *mut [u8; lean_xmss::SIG_SIZE],
) {
    let (key, message) = unsafe { (&*key, &*message) };
    let signature = lean_xmss::sign(&key.expanded, message, leaf_index);
    unsafe { out_signature.write(signature.to_bytes()) };
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
    if lean_xmss::verify(&public_key, message, &signature) {
        OK
    } else {
        ERR_INVALID_SIGNATURE
    }
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
        // `aggregate` takes a slice of proofs with their claims, not of pointers to them.
        let children: Vec<_> = unsafe { slice(children, children_len) }
            .iter()
            .map(|&child| {
                let child = unsafe { &*child };
                (child.claims.clone(), child.proof.clone())
            })
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
        let output = declare.as_ref().map_or(OutputClaims::All, OutputClaims::Only);
        let (claims, proof) = lean_vm::aggregate(&children, signed, Vec::new(), None, output, log_inv_rate as usize)
            .map_err(aggregate_status)?;
        unsafe { out_proof.write(boxed(Proof { claims, proof })) };
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
        let proof = AggregateProof::from_bytes(bytes).ok_or(ERR_MALFORMED_ENCODING)?;
        let claims = claims_of(claims);
        unsafe { out_proof.write(boxed(Proof { claims, proof })) };
        Ok(())
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_proof_free(proof: *mut Proof) {
    drop(unsafe { Box::from_raw(proof) });
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_proof_verify(proof: *const Proof) -> i32 {
    let Proof { claims, proof } = unsafe { &*proof };
    if proof.verify(claims) { OK } else { ERR_INVALID_PROOF }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_proof_to_bytes(proof: *const Proof, out_bytes: *mut *mut u8, out_len: *mut usize) {
    let bytes = unsafe { &*proof }.proof.to_bytes().into_boxed_slice();
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
    unsafe { &*proof }.claims.lean_xmss.len()
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn leanvm_proof_claims(proof: *const Proof, out_claims: *mut Claim) {
    for (i, (public_key, message)) in unsafe { &*proof }.claims.lean_xmss.iter().enumerate() {
        let claim = Claim {
            public_key: public_key.to_bytes(),
            message: *message,
        };
        unsafe { out_claims.add(i).write(claim) };
    }
}
