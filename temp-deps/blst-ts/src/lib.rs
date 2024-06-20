#![deny(clippy::all)]

use blst::{blst_scalar, blst_scalar_from_uint64, min_pk, BLST_ERROR};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use rand::{rngs::ThreadRng, Rng};

const DST: &[u8] = b"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_";

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

#[napi]
impl SecretKey {
  #[napi(factory)]
  pub fn from_keygen(ikm: Uint8Array, key_info: Option<Uint8Array>) -> Result<Self> {
    let key_info = key_info.as_deref().unwrap_or(&[]);
    min_pk::SecretKey::key_gen(&ikm, key_info)
      .map(Self)
      .map_err(to_err)
  }

  #[napi(factory)]
  pub fn derive_master_eip2333(ikm: Uint8Array) -> Result<Self> {
    min_pk::SecretKey::derive_master_eip2333(&ikm)
      .map(Self)
      .map_err(to_err)
  }

  #[napi]
  pub fn derive_child_eip2333(&self, index: u32) -> Self {
    Self(self.0.derive_child_eip2333(index))
  }

  #[napi(factory)]
  pub fn deserialize(bytes: Uint8Array) -> Result<Self> {
    Self::from_slice(&bytes)
  }

  #[napi(factory)]
  pub fn from_hex(hex: String) -> Result<Self> {
    let bytes =
      hex::decode(&hex.trim_start_matches("0x")).map_err(|_| Error::from_reason("Invalid hex"))?;
    Self::from_slice(&bytes)
  }

  fn from_slice(bytes: &[u8]) -> Result<Self> {
    min_pk::SecretKey::deserialize(&bytes)
      .map(Self)
      .map_err(to_err)
  }

  #[napi]
  pub fn serialize(&self) -> Uint8Array {
    Uint8Array::from(self.0.to_bytes())
  }

  #[napi]
  pub fn to_hex(&self) -> String {
    format!("0x{}", hex::encode(self.0.to_bytes()))
  }

  #[napi]
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
  pub fn deserialize(bytes: Uint8Array, pk_validate: Option<bool>) -> Result<Self> {
    Self::from_slice(&bytes, pk_validate)
  }

  #[napi(factory)]
  pub fn from_hex(hex: String, pk_validate: Option<bool>) -> Result<Self> {
    let bytes =
      hex::decode(&hex.trim_start_matches("0x")).map_err(|_| Error::from_reason("Invalid hex"))?;
    Self::from_slice(&bytes, pk_validate)
  }

  fn from_slice(bytes: &[u8], pk_validate: Option<bool>) -> Result<Self> {
    let pk = if pk_validate == Some(true) {
      min_pk::PublicKey::key_validate(&bytes)
    } else {
      min_pk::PublicKey::deserialize(&bytes)
    };
    pk.map(Self).map_err(to_err)
  }

  #[napi]
  pub fn serialize(&self) -> Uint8Array {
    let bytes = self.0.to_bytes();
    Uint8Array::from(bytes)
  }

  #[napi]
  pub fn to_hex(&self) -> String {
    format!("0x{}", hex::encode(self.0.to_bytes()))
  }

  #[napi]
  pub fn key_validate(&self) -> Result<Undefined> {
    self.0.validate().map_err(to_err)
  }
}

#[napi]
impl Signature {
  #[napi(factory)]
  pub fn deserialize(
    bytes: Uint8Array,
    sig_validate: Option<bool>,
    sig_infcheck: Option<bool>,
  ) -> Result<Self> {
    Self::from_slice(&bytes, sig_validate, sig_infcheck)
  }

  #[napi(factory)]
  pub fn from_hex(
    hex: String,
    sig_validate: Option<bool>,
    sig_infcheck: Option<bool>,
  ) -> Result<Self> {
    let bytes =
      hex::decode(&hex.trim_start_matches("0x")).map_err(|_| Error::from_reason("Invalid hex"))?;
    Self::from_slice(&bytes, sig_validate, sig_infcheck)
  }

  fn from_slice(
    bytes: &[u8],
    sig_validate: Option<bool>,
    sig_infcheck: Option<bool>,
  ) -> Result<Self> {
    let sig = if sig_validate == Some(true) {
      min_pk::Signature::sig_validate(&bytes, sig_infcheck.unwrap_or(true))
    } else {
      min_pk::Signature::deserialize(&bytes)
    };
    sig.map(Self).map_err(to_err)
  }

  #[napi]
  pub fn serialize(&self) -> Uint8Array {
    Uint8Array::from(self.0.to_bytes())
  }

  #[napi]
  pub fn to_hex(&self) -> String {
    format!("0x{}", hex::encode(self.0.to_bytes()))
  }

  #[napi]
  pub fn sig_validate(&self, sig_infcheck: Option<bool>) -> Result<Undefined> {
    min_pk::Signature::validate(&self.0, sig_infcheck.unwrap_or(false)).map_err(to_err)
  }
}

#[napi]
pub fn aggregate_public_keys(
  pks: Vec<&PublicKey>,
  pks_validate: Option<bool>,
) -> Result<PublicKey> {
  let pks = pks.iter().map(|pk| &pk.0).collect::<Vec<_>>();
  min_pk::AggregatePublicKey::aggregate(&pks, pks_validate.unwrap_or(false))
    .map(|pk| PublicKey(pk.to_public_key()))
    .map_err(to_err)
}

#[napi]
pub fn aggregate_signatures(
  sigs: Vec<&Signature>,
  sigs_groupcheck: Option<bool>,
) -> Result<Signature> {
  let sigs = sigs.iter().map(|s| &s.0).collect::<Vec<_>>();
  min_pk::AggregateSignature::aggregate(&sigs, sigs_groupcheck.unwrap_or(false))
    .map(|sig| Signature(sig.to_signature()))
    .map_err(to_err)
}

#[napi]
pub fn aggregate_serialized_public_keys(
  pks: Vec<Uint8Array>,
  pks_validate: Option<bool>,
) -> Result<PublicKey> {
  let pks = pks.iter().map(|pk| pk.as_ref()).collect::<Vec<_>>();
  min_pk::AggregatePublicKey::aggregate_serialized(&pks, pks_validate.unwrap_or(false))
    .map(|pk| PublicKey(pk.to_public_key()))
    .map_err(to_err)
}

#[napi]
pub fn aggregate_serialized_signatures(
  sigs: Vec<Uint8Array>,
  sigs_groupcheck: Option<bool>,
) -> Result<Signature> {
  let sigs = sigs.iter().map(|s| s.as_ref()).collect::<Vec<_>>();
  min_pk::AggregateSignature::aggregate_serialized(&sigs, sigs_groupcheck.unwrap_or(false))
    .map(|sig| Signature(sig.to_signature()))
    .map_err(to_err)
}

#[napi(object)]
pub struct AggregationSet {
  pub pk: Reference<PublicKey>,
  pub sig: Uint8Array,
}

#[napi(object)]
pub struct AggregatedSet {
  pub pk: Reference<PublicKey>,
  pub sig: Reference<Signature>,
}

#[napi]
pub fn aggregate_with_randomness(env: Env, sets: Vec<AggregationSet>) -> Result<AggregatedSet> {
  let mut rng = rand::thread_rng();
  let rand0 = create_scalar(rand_non_zero(&mut rng));
  let mut public_key =
    min_pk::AggregatePublicKey::from_public_key(&sets[0].pk.0.multiply_by(&rand0.b, 64));
  let mut signature = min_pk::AggregateSignature::from_signature(
    &min_pk::Signature::deserialize(&sets[0].sig)
      .map_err(to_err)?
      .multiply_by(&rand0.b, 64),
  );
  for set in sets.iter().skip(1) {
    let rand_val = create_scalar(rand_non_zero(&mut rng));
    public_key
      .add_public_key(&set.pk.0.multiply_by(&rand_val.b, 64), false)
      .map_err(to_err)?;
    signature
      .add_signature(
        &(min_pk::Signature::deserialize(&set.sig).map_err(to_err)?).multiply_by(&rand_val.b, 64),
        false,
      )
      .map_err(to_err)?;
  }

  Ok(AggregatedSet {
    pk: PublicKey::into_reference(PublicKey(public_key.to_public_key()), env)?,
    sig: Signature::into_reference(Signature(signature.to_signature()), env)?,
  })
}

#[napi]
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
pub fn fast_aggregate_verify_pre_aggregated(
  msg: Uint8Array,
  pk: &PublicKey,
  sig: &Signature,
  sigs_groupcheck: Option<bool>,
) -> bool {
  min_pk::Signature::fast_aggregate_verify_pre_aggregated(
    &sig.0,
    sigs_groupcheck.unwrap_or(false),
    &msg,
    &DST,
    &pk.0,
  ) == BLST_ERROR::BLST_SUCCESS
}

#[napi]
pub fn verify_multiple_aggregate_signatures(
  sets: Vec<SignatureSet>,
  pks_validate: Option<bool>,
  sigs_groupcheck: Option<bool>,
) -> bool {
  let (msgs, pks, sigs) = convert_sets(&sets);
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

#[napi]
pub async fn aggregate_public_keys_async(
  pks: Vec<&PublicKey>,
  pks_validate: Option<bool>,
) -> Result<PublicKey> {
  aggregate_public_keys(pks, pks_validate)
}

#[napi]
pub async fn aggregate_signatures_async(
  sigs: Vec<&Signature>,
  sigs_groupcheck: Option<bool>,
) -> Result<Signature> {
  aggregate_signatures(sigs, sigs_groupcheck)
}

#[napi]
pub async fn aggregate_serialized_public_keys_async(
  pks: Vec<Uint8Array>,
  pks_validate: Option<bool>,
) -> Result<PublicKey> {
  aggregate_serialized_public_keys(pks, pks_validate)
}

#[napi]
pub async fn aggregate_serialized_signatures_async(
  sigs: Vec<Uint8Array>,
  sigs_groupcheck: Option<bool>,
) -> Result<Signature> {
  aggregate_serialized_signatures(sigs, sigs_groupcheck)
}

#[napi]
pub async fn verify_async(
  msg: Uint8Array,
  pk: &PublicKey,
  sig: &Signature,
  pk_validate: Option<bool>,
  sig_groupcheck: Option<bool>,
) -> bool {
  verify(msg, pk, sig, pk_validate, sig_groupcheck)
}

#[napi]
pub async fn aggregate_verify_async(
  msgs: Vec<Uint8Array>,
  pks: Vec<&PublicKey>,
  sig: &Signature,
  pk_validate: Option<bool>,
  sigs_groupcheck: Option<bool>,
) -> bool {
  aggregate_verify(msgs, pks, sig, pk_validate, sigs_groupcheck)
}

#[napi]
pub async fn fast_aggregate_verify_async(
  msg: Uint8Array,
  pks: Vec<&PublicKey>,
  sig: &Signature,
  sigs_groupcheck: Option<bool>,
) -> bool {
  fast_aggregate_verify(msg, pks, sig, sigs_groupcheck)
}

#[napi]
pub async fn fast_aggregate_verify_pre_aggregated_async(
  msg: Uint8Array,
  pk: &PublicKey,
  sig: &Signature,
  sigs_groupcheck: Option<bool>,
) -> bool {
  fast_aggregate_verify_pre_aggregated(msg, pk, sig, sigs_groupcheck)
}

#[napi]
pub async fn verify_multiple_aggregate_signatures_async(
  sets: Vec<SignatureSet>,
  pks_validate: Option<bool>,
  sigs_groupcheck: Option<bool>,
) -> bool {
  verify_multiple_aggregate_signatures(sets, pks_validate, sigs_groupcheck)
}

fn blst_error_to_string(error: BLST_ERROR) -> String {
  match error {
    BLST_ERROR::BLST_SUCCESS => "BLST_SUCCESS".to_string(),
    BLST_ERROR::BLST_BAD_ENCODING => "Invalid encoding".to_string(),
    BLST_ERROR::BLST_POINT_NOT_ON_CURVE => "Point not on curve".to_string(),
    BLST_ERROR::BLST_POINT_NOT_IN_GROUP => "Point not in group".to_string(),
    BLST_ERROR::BLST_AGGR_TYPE_MISMATCH => "Aggregation type mismatch".to_string(),
    BLST_ERROR::BLST_VERIFY_FAIL => "Verification failed".to_string(),
    BLST_ERROR::BLST_PK_IS_INFINITY => "Public key is infinity".to_string(),
    BLST_ERROR::BLST_BAD_SCALAR => "Invalid scalar".to_string(),
  }
}

fn to_err(blst_error: BLST_ERROR) -> napi::Error {
  napi::Error::from_reason(blst_error_to_string(blst_error))
}

pub fn convert_sets<'a>(
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

fn rand_non_zero(rng: &mut ThreadRng) -> u64 {
  loop {
    let r = rng.gen();
    if r != 0 {
      return r;
    }
  }
}

fn create_scalar(i: u64) -> blst_scalar {
  let mut vals = [0u64; 4];
  vals[0] = i;
  let mut scalar = std::mem::MaybeUninit::<blst_scalar>::uninit();
  // TODO: remove this `unsafe` code-block once we get a safe option from `blst`.
  //
  // https://github.com/sigp/lighthouse/issues/1720
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
