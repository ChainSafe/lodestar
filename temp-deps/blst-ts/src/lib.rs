#![deny(clippy::all)]

use blst::{blst_scalar, blst_scalar_from_uint64, min_pk, MultiPoint, BLST_ERROR};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use rand::{rngs::ThreadRng, Rng};

/// See https://github.com/ethereum/consensus-specs/blob/v1.4.0/specs/phase0/beacon-chain.md#bls-signatures
const DST: &[u8] = b"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_";

/// The length of a secret key.
#[napi]
pub const SECRET_KEY_LENGTH: u32 = 32;

/// The length of a serialized public key.
#[napi]
pub const PUBLIC_KEY_LENGTH_COMPRESSED: u32 = 48;
#[napi]
pub const PUBLIC_KEY_LENGTH_UNCOMPRESSED: u32 = 96;

/// The length of a serialized signature.
#[napi]
pub const SIGNATURE_LENGTH_COMPRESSED: u32 = 96;
#[napi]
pub const SIGNATURE_LENGTH_UNCOMPRESSED: u32 = 192;

/// Custom error status for programmatic error handling.
/// This status will be populated in `Error#code` on the javascript side
pub enum ErrorStatus {
  Blst(BLST_ERROR),
  InvalidHex,
  Other(String),
}

impl AsRef<str> for ErrorStatus {
  fn as_ref(&self) -> &str {
    match self {
      ErrorStatus::Blst(err) => blst_error_to_str(*err),
      ErrorStatus::InvalidHex => "INVALID_HEX",
      ErrorStatus::Other(err) => err.as_str(),
    }
  }
}

/// BLST_ERROR to human readable string
fn blst_error_to_reason<'a>(error: BLST_ERROR) -> &'a str {
  match error {
    BLST_ERROR::BLST_SUCCESS => "BLST_SUCCESS",
    BLST_ERROR::BLST_BAD_ENCODING => "Invalid encoding",
    BLST_ERROR::BLST_POINT_NOT_ON_CURVE => "Point not on curve",
    BLST_ERROR::BLST_POINT_NOT_IN_GROUP => "Point not in group",
    BLST_ERROR::BLST_AGGR_TYPE_MISMATCH => "Aggregation type mismatch",
    BLST_ERROR::BLST_VERIFY_FAIL => "Verification failed",
    BLST_ERROR::BLST_PK_IS_INFINITY => "Public key is infinity",
    BLST_ERROR::BLST_BAD_SCALAR => "Invalid scalar",
  }
}

/// BLST_ERROR to "error code"
fn blst_error_to_str<'a>(err: BLST_ERROR) -> &'a str {
  match err {
    BLST_ERROR::BLST_SUCCESS => "BLST_SUCCESS",
    BLST_ERROR::BLST_BAD_ENCODING => "BLST_BAD_ENCODING",
    BLST_ERROR::BLST_POINT_NOT_ON_CURVE => "BLST_POINT_NOT_ON_CURVE",
    BLST_ERROR::BLST_POINT_NOT_IN_GROUP => "BLST_POINT_NOT_IN_GROUP",
    BLST_ERROR::BLST_AGGR_TYPE_MISMATCH => "BLST_AGGR_TYPE_MISMATCH",
    BLST_ERROR::BLST_VERIFY_FAIL => "BLST_VERIFY_FAIL",
    BLST_ERROR::BLST_PK_IS_INFINITY => "BLST_PK_IS_INFINITY",
    BLST_ERROR::BLST_BAD_SCALAR => "BLST_BAD_SCALAR",
  }
}

fn from_blst_err(blst_error: BLST_ERROR) -> Error<ErrorStatus> {
  Error::new(
    ErrorStatus::Blst(blst_error),
    blst_error_to_reason(blst_error),
  )
}

fn from_napi_err(napi_err: Error) -> Error<ErrorStatus> {
  Error::new(
    ErrorStatus::Other(napi_err.status.to_string()),
    napi_err.reason.to_string(),
  )
}

fn invalid_hex_err(e: hex::FromHexError) -> Error<ErrorStatus> {
  Error::new(ErrorStatus::InvalidHex, format!("Invalid hex: {}", e))
}

// All errors returned from this module will be of type `napi::Error<ErrorStatus>`
type Result<T> = napi::Result<T, ErrorStatus>;

//// Exposed classes / objects

#[napi]
pub struct SecretKey(min_pk::SecretKey);

#[napi]
pub struct PublicKey(min_pk::PublicKey);

#[napi]
pub struct Signature(min_pk::Signature);

#[napi(object)]
pub struct SignatureSet {
  pub msg: Uint8Array,
  pub pk: Reference<PublicKey>,
  pub sig: Reference<Signature>,
}

#[napi(object)]
pub struct PkAndSerializedSig {
  pub pk: Reference<PublicKey>,
  pub sig: Uint8Array,
}

#[napi(object)]
pub struct PkAndSig {
  pub pk: Reference<PublicKey>,
  pub sig: Reference<Signature>,
}

#[napi]
impl SecretKey {
  #[napi(factory)]
  /// Generate a secret key deterministically from a secret byte array `ikm`.
  ///
  /// `ikm` must be at least 32 bytes long.
  ///
  /// Optionally pass `key_info` bytes to derive multiple independent keys from the same `ikm`.
  /// By default, the `key_info` is empty.
  pub fn from_keygen(ikm: Uint8Array, key_info: Option<Uint8Array>) -> Result<Self> {
    let key_info = key_info.as_deref().unwrap_or(&[]);
    min_pk::SecretKey::key_gen(&ikm, key_info)
      .map(Self)
      .map_err(from_blst_err)
  }

  #[napi(factory)]
  /// Generate a master secret key deterministically from a secret byte array `ikm` based on EIP-2333.
  ///
  /// `ikm` must be at least 32 bytes long.
  ///
  /// See https://eips.ethereum.org/EIPS/eip-2333
  pub fn derive_master_eip2333(ikm: Uint8Array) -> Result<Self> {
    min_pk::SecretKey::derive_master_eip2333(&ikm)
      .map(Self)
      .map_err(from_blst_err)
  }

  #[napi]
  /// Derive a child secret key from a parent secret key based on EIP-2333.
  ///
  /// See https://eips.ethereum.org/EIPS/eip-2333
  pub fn derive_child_eip2333(&self, index: u32) -> Self {
    Self(self.0.derive_child_eip2333(index))
  }

  #[napi(factory)]
  /// Deserialize a secret key from a byte array.
  pub fn from_bytes(bytes: Uint8Array) -> Result<Self> {
    Self::from_slice(&bytes)
  }

  #[napi(factory)]
  /// Deserialize a secret key from a hex string.
  pub fn from_hex(hex: String) -> Result<Self> {
    let bytes = hex::decode(&hex.trim_start_matches("0x")).map_err(invalid_hex_err)?;
    Self::from_slice(&bytes)
  }

  fn from_slice(bytes: &[u8]) -> Result<Self> {
    min_pk::SecretKey::from_bytes(&bytes)
      .map(Self)
      .map_err(from_blst_err)
  }

  #[napi]
  /// Serialize a secret key to a byte array.
  pub fn to_bytes(&self) -> Uint8Array {
    Uint8Array::from(self.0.to_bytes())
  }

  #[napi]
  /// Serialize a secret key to a hex string.
  pub fn to_hex(&self) -> String {
    format!("0x{}", hex::encode(self.0.to_bytes()))
  }

  #[napi]
  /// Return the corresponding public key
  pub fn to_public_key(&self) -> PublicKey {
    PublicKey(self.0.sk_to_pk())
  }

  #[napi]
  pub fn sign(&self, msg: Uint8Array) -> Signature {
    Signature(self.0.sign(&msg, &DST, &[]))
  }
}

#[napi]
impl PublicKey {
  #[napi(factory)]
  /// Deserialize a public key from a byte array.
  ///
  /// If `pk_validate` is `true`, the public key will be infinity and group checked.
  pub fn from_bytes(bytes: Uint8Array, pk_validate: Option<bool>) -> Result<Self> {
    Self::from_slice(&bytes, pk_validate)
  }

  #[napi(factory)]
  /// Deserialize a public key from a hex string.
  ///
  /// If `pk_validate` is `true`, the public key will be infinity and group checked.
  pub fn from_hex(hex: String, pk_validate: Option<bool>) -> Result<Self> {
    let bytes = hex::decode(&hex.trim_start_matches("0x")).map_err(invalid_hex_err)?;
    Self::from_slice(&bytes, pk_validate)
  }

  fn from_slice(bytes: &[u8], pk_validate: Option<bool>) -> Result<Self> {
    let pk = if pk_validate.unwrap_or(false) {
      min_pk::PublicKey::key_validate(&bytes)
    } else {
      min_pk::PublicKey::from_bytes(&bytes)
    };
    pk.map(Self).map_err(from_blst_err)
  }

  #[napi]
  /// Serialize a public key to a byte array.
  pub fn to_bytes(&self, compress: Option<bool>) -> Uint8Array {
    self.to_vec(compress).into()
  }

  #[napi]
  /// Serialize a public key to a hex string.
  pub fn to_hex(&self, compress: Option<bool>) -> String {
    format!("0x{}", hex::encode(self.to_vec(compress)))
  }

  fn to_vec(&self, compress: Option<bool>) -> Vec<u8> {
    if compress.unwrap_or(true) {
      return self.0.compress().to_vec();
    }
    self.0.serialize().to_vec()
  }

  #[napi]
  /// Validate a public key with infinity and group check.
  pub fn key_validate(&self) -> Result<Undefined> {
    self.0.validate().map_err(from_blst_err)
  }
}

#[napi]
impl Signature {
  #[napi(factory)]
  /// Deserialize a signature from a byte array.
  ///
  /// If `sig_validate` is `true`, the public key will be infinity and group checked.
  ///
  /// If `sig_infcheck` is `false`, the infinity check will be skipped.
  pub fn from_bytes(
    bytes: Uint8Array,
    sig_validate: Option<bool>,
    sig_infcheck: Option<bool>,
  ) -> Result<Self> {
    Self::from_slice(&bytes, sig_validate, sig_infcheck)
  }

  #[napi(factory)]
  /// Deserialize a signature from a hex string.
  ///
  /// If `sig_validate` is `true`, the public key will be infinity and group checked.
  ///
  /// If `sig_infcheck` is `false`, the infinity check will be skipped.
  pub fn from_hex(
    hex: String,
    sig_validate: Option<bool>,
    sig_infcheck: Option<bool>,
  ) -> Result<Self> {
    let bytes = hex::decode(&hex.trim_start_matches("0x")).map_err(invalid_hex_err)?;
    Self::from_slice(&bytes, sig_validate, sig_infcheck)
  }

  fn from_slice(
    bytes: &[u8],
    sig_validate: Option<bool>,
    sig_infcheck: Option<bool>,
  ) -> Result<Self> {
    let sig = if sig_validate.unwrap_or(false) {
      min_pk::Signature::sig_validate(&bytes, sig_infcheck.unwrap_or(true))
    } else {
      min_pk::Signature::from_bytes(&bytes)
    };
    sig.map(Self).map_err(from_blst_err)
  }

  #[napi]
  /// Serialize a signature to a byte array.
  pub fn to_bytes(&self, compress: Option<bool>) -> Uint8Array {
    Uint8Array::from(self.to_vec(compress))
  }

  #[napi]
  /// Serialize a signature to a hex string.
  pub fn to_hex(&self, compress: Option<bool>) -> String {
    format!("0x{}", hex::encode(self.to_vec(compress)))
  }

  fn to_vec(&self, compress: Option<bool>) -> Vec<u8> {
    if compress.unwrap_or(true) {
      return self.0.compress().to_vec();
    }
    self.0.serialize().to_vec()
  }

  #[napi]
  /// Validate a signature with infinity and group check.
  ///
  /// If `sig_infcheck` is `false`, the infinity check will be skipped.
  pub fn sig_validate(&self, sig_infcheck: Option<bool>) -> Result<Undefined> {
    min_pk::Signature::validate(&self.0, sig_infcheck.unwrap_or(true)).map_err(from_blst_err)
  }
}

//// Exposed functions

#[napi]
/// Aggregate multiple public keys into a single public key.
///
/// If `pks_validate` is `true`, the public keys will be infinity and group checked.
pub fn aggregate_public_keys(
  pks: Vec<&PublicKey>,
  pks_validate: Option<bool>,
) -> Result<PublicKey> {
  let pks = pks.iter().map(|pk| &pk.0).collect::<Vec<_>>();
  min_pk::AggregatePublicKey::aggregate(&pks, pks_validate.unwrap_or(false))
    .map(|pk| PublicKey(pk.to_public_key()))
    .map_err(from_blst_err)
}

#[napi]
/// Aggregate multiple signatures into a single signature.
///
/// If `sigs_groupcheck` is `true`, the signatures will be group checked.
pub fn aggregate_signatures(
  sigs: Vec<&Signature>,
  sigs_groupcheck: Option<bool>,
) -> Result<Signature> {
  let sigs = sigs.iter().map(|s| &s.0).collect::<Vec<_>>();
  min_pk::AggregateSignature::aggregate(&sigs, sigs_groupcheck.unwrap_or(false))
    .map(|sig| Signature(sig.to_signature()))
    .map_err(from_blst_err)
}

#[napi]
/// Aggregate multiple serialized public keys into a single public key.
///
/// If `pks_validate` is `true`, the public keys will be infinity and group checked.
pub fn aggregate_serialized_public_keys(
  pks: Vec<Uint8Array>,
  pks_validate: Option<bool>,
) -> Result<PublicKey> {
  let pks = pks.iter().map(|pk| pk.as_ref()).collect::<Vec<_>>();
  min_pk::AggregatePublicKey::aggregate_serialized(&pks, pks_validate.unwrap_or(false))
    .map(|pk| PublicKey(pk.to_public_key()))
    .map_err(from_blst_err)
}

#[napi]
/// Aggregate multiple serialized signatures into a single signature.
///
/// If `sigs_groupcheck` is `true`, the signatures will be group checked.
pub fn aggregate_serialized_signatures(
  sigs: Vec<Uint8Array>,
  sigs_groupcheck: Option<bool>,
) -> Result<Signature> {
  let sigs = sigs.iter().map(|s| s.as_ref()).collect::<Vec<_>>();
  min_pk::AggregateSignature::aggregate_serialized(&sigs, sigs_groupcheck.unwrap_or(false))
    .map(|sig| Signature(sig.to_signature()))
    .map_err(from_blst_err)
}

#[napi]
/// Aggregate multiple public keys and multiple serialized signatures into a single blinded public key and blinded signature.
///
/// Signatures are deserialized and validated with infinity and group checks before aggregation.
pub fn aggregate_with_randomness(env: Env, sets: Vec<PkAndSerializedSig>) -> Result<PkAndSig> {
  if sets.is_empty() {
    return Err(from_blst_err(BLST_ERROR::BLST_AGGR_TYPE_MISMATCH));
  }

  let (pks, sigs) = unzip_and_validate_aggregation_sets(&sets)?;
  let rands = create_rand_slice(pks.len());
  let (pk, sig) = aggregate_with(pks.as_slice(), sigs.as_slice(), rands.as_slice());

  Ok(PkAndSig {
    pk: PublicKey::into_reference(PublicKey(pk), env).map_err(from_napi_err)?,
    sig: Signature::into_reference(Signature(sig), env).map_err(from_napi_err)?,
  })
}

#[napi]
/// Verify a signature against a message and public key.
///
/// If `pk_validate` is `true`, the public key will be infinity and group checked.
///
/// If `sig_groupcheck` is `true`, the signature will be group checked.
pub fn verify(
  msg: Uint8Array,
  pk: &PublicKey,
  sig: &Signature,
  pk_validate: Option<bool>,
  sig_groupcheck: Option<bool>,
) -> bool {
  sig.0.verify(
    sig_groupcheck.unwrap_or(false),
    &msg,
    &DST,
    &[],
    &pk.0,
    pk_validate.unwrap_or(false),
  ) == BLST_ERROR::BLST_SUCCESS
}

#[napi]
/// Verify an aggregated signature against multiple messages and multiple public keys.
///
/// If `pk_validate` is `true`, the public keys will be infinity and group checked.
///
/// If `sigs_groupcheck` is `true`, the signatures will be group checked.
pub fn aggregate_verify(
  msgs: Vec<Uint8Array>,
  pks: Vec<&PublicKey>,
  sig: &Signature,
  pk_validate: Option<bool>,
  sigs_groupcheck: Option<bool>,
) -> bool {
  let pks = pks.iter().map(|pk| &pk.0).collect::<Vec<_>>();
  let msgs = msgs.iter().map(|msg| msg.as_ref()).collect::<Vec<_>>();
  min_pk::Signature::aggregate_verify(
    &sig.0,
    sigs_groupcheck.unwrap_or(false),
    &msgs,
    &DST,
    &pks,
    pk_validate.unwrap_or(false),
  ) == BLST_ERROR::BLST_SUCCESS
}

#[napi]
/// Verify an aggregated signature against a single message and multiple public keys.
///
/// Proof-of-possession is required for public keys.
///
/// If `sigs_groupcheck` is `true`, the signatures will be group checked.
pub fn fast_aggregate_verify(
  msg: Uint8Array,
  pks: Vec<&PublicKey>,
  sig: &Signature,
  sigs_groupcheck: Option<bool>,
) -> bool {
  let pks = pks.iter().map(|pk| &pk.0).collect::<Vec<_>>();
  min_pk::Signature::fast_aggregate_verify(
    &sig.0,
    sigs_groupcheck.unwrap_or(false),
    &msg,
    &DST,
    &pks,
  ) == BLST_ERROR::BLST_SUCCESS
}

#[napi]
/// Verify multiple aggregated signatures against multiple messages and multiple public keys.
///
/// If `pks_validate` is `true`, the public keys will be infinity and group checked.
///
/// If `sigs_groupcheck` is `true`, the signatures will be group checked.
///
/// See https://ethresear.ch/t/fast-verification-of-multiple-bls-signatures/5407
pub fn verify_multiple_aggregate_signatures(
  sets: Vec<SignatureSet>,
  pks_validate: Option<bool>,
  sigs_groupcheck: Option<bool>,
) -> bool {
  let (msgs, pks, sigs) = unzip_signature_sets(&sets);
  let rands = create_rand_scalars(sets.len());
  min_pk::Signature::verify_multiple_aggregate_signatures(
    &msgs,
    &DST,
    &pks,
    pks_validate.unwrap_or(false),
    &sigs,
    sigs_groupcheck.unwrap_or(false),
    &rands,
    64,
  ) == BLST_ERROR::BLST_SUCCESS
}

//// Utility functions

/// Convert a list of tuples into a tuple of lists
fn unzip_signature_sets<'a>(
  sets: &'a [SignatureSet],
) -> (
  Vec<&'a [u8]>,
  Vec<&'a min_pk::PublicKey>,
  Vec<&'a min_pk::Signature>,
) {
  let len = sets.len();
  let mut msgs = Vec::with_capacity(len);
  let mut pks = Vec::with_capacity(len);
  let mut sigs = Vec::with_capacity(len);

  for set in sets {
    msgs.push(set.msg.as_ref());
    pks.push(&set.pk.0);
    sigs.push(&set.sig.0);
  }

  (msgs, pks, sigs)
}

/// Convert a list of tuples into a tuple of lists (deserializing and validating signatures along the way)
fn unzip_and_validate_aggregation_sets(
  sets: &[PkAndSerializedSig],
) -> Result<(Vec<min_pk::PublicKey>, Vec<min_pk::Signature>)> {
  let len = sets.len();
  let mut pks = Vec::with_capacity(len);
  let mut sigs = Vec::with_capacity(len);

  for set in sets {
    pks.push(set.pk.0);
    sigs.push(min_pk::Signature::sig_validate(set.sig.as_ref(), true).map_err(from_blst_err)?);
  }

  Ok((pks, sigs))
}

/// randomness used for multiplication (can't be zero)
fn rand_non_zero(rng: &mut ThreadRng) -> u64 {
  loop {
    let r = rng.gen();
    if r != 0 {
      return r;
    }
  }
}

/// copied from lighthouse:
/// https://github.com/sigp/lighthouse/blob/9e12c21f268c80a3f002ae0ca27477f9f512eb6f/crypto/bls/src/impls/blst.rs#L52
fn create_scalar(i: u64) -> blst_scalar {
  let vals = [i, 0, 0, 0];
  let mut scalar = std::mem::MaybeUninit::<blst_scalar>::uninit();
  unsafe {
    blst_scalar_from_uint64(scalar.as_mut_ptr(), vals.as_ptr());
    scalar.assume_init()
  }
}

/// Creates a vector of random scalars, each 64 bits
fn create_rand_scalars(len: usize) -> Vec<blst_scalar> {
  let mut rng = rand::thread_rng();
  (0..len)
    .map(|_| create_scalar(rand_non_zero(&mut rng)))
    .collect()
}

/// Creates a vector of random bytes, length len * 8
fn create_rand_slice(len: usize) -> Vec<u8> {
  let mut rng = rand::thread_rng();
  (0..len)
    .map(|_| rand_non_zero(&mut rng).to_ne_bytes())
    .flatten()
    .collect()
}

/// pks.len() == sigs.len() == rands.len() * 8
fn aggregate_with(
  pks: &[min_pk::PublicKey],
  sigs: &[min_pk::Signature],
  scalars: &[u8],
) -> (min_pk::PublicKey, min_pk::Signature) {
  let pk = pks.mult(scalars, 64).to_public_key();
  let sig = sigs.mult(scalars, 64).to_signature();

  (pk, sig)
}
