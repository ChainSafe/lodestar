#include "addon.h"

bool is_zero_bytes(
    const uint8_t *data, const size_t start_byte, const size_t byte_length) {
    for (size_t i = start_byte; i < byte_length; i++) {
        if (data[i] != 0) {
            return false;
        }
    }
    return true;
}

bool is_valid_length(
    std::string &error_out,
    size_t byte_length,
    size_t length1,
    size_t length2) {
    if (byte_length == length1 || (length2 != 0 && byte_length == length2)) {
        return true;
    }
    error_out.append(
        " is " + std::to_string(byte_length) + " bytes, but must be ");
    if (length1 != 0) {
        error_out.append(std::to_string(length1));
    };
    if (length2 != 0) {
        if (length1 != 0) {
            error_out.append(" or ");
        }
        error_out.append(std::to_string(length2));
    };
    error_out.append(" bytes long");
    return false;
}

BlstTsAddon::BlstTsAddon(Napi::Env env, Napi::Object exports)
    : _dst{"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_"},
      _blst_error_strings{
          "BLST_SUCCESS",
          "BLST_ERROR::BLST_BAD_ENCODING",
          "BLST_ERROR::BLST_POINT_NOT_ON_CURVE",
          "BLST_ERROR::BLST_POINT_NOT_IN_GROUP",
          "BLST_ERROR::BLST_AGGR_TYPE_MISMATCH",
          "BLST_ERROR::BLST_VERIFY_FAIL",
          "BLST_ERROR::BLST_PK_IS_INFINITY",
          "BLST_ERROR::BLST_BAD_SCALAR",
      } {
    Napi::Object js_constants = Napi::Object::New(env);
    js_constants.Set(
        Napi::String::New(env, "DST"), Napi::String::New(env, _dst));
    DefineAddon(
        exports,
        {
            InstanceValue("BLST_CONSTANTS", js_constants, napi_enumerable),
        });
    SecretKey::Init(env, exports, this);
    PublicKey::Init(env, exports, this);
    Signature::Init(env, exports, this);
    Functions::Init(env, exports);
    env.SetInstanceData(this);

    // Check that openssl PRNG is seeded
    blst::byte seed{0};
    if (!this->GetRandomBytes(&seed, 0)) {
        Napi::Error::New(env, "BLST_ERROR: Error seeding pseudo-random number generator")
            .ThrowAsJavaScriptException();
    }
}

std::string BlstTsAddon::GetBlstErrorString(const blst::BLST_ERROR &err) {
    return _blst_error_strings[err];
}

bool BlstTsAddon::GetRandomBytes(blst::byte *bytes, size_t length) {
    // [randomBytes](https://github.com/nodejs/node/blob/4166d40d0873b6d8a0c7291872c8d20dc680b1d7/lib/internal/crypto/random.js#L98)
    // [RandomBytesJob](https://github.com/nodejs/node/blob/4166d40d0873b6d8a0c7291872c8d20dc680b1d7/lib/internal/crypto/random.js#L139)
    // [RandomBytesTraits::DeriveBits](https://github.com/nodejs/node/blob/4166d40d0873b6d8a0c7291872c8d20dc680b1d7/src/crypto/crypto_random.cc#L65)
    // [CSPRNG](https://github.com/nodejs/node/blob/4166d40d0873b6d8a0c7291872c8d20dc680b1d7/src/crypto/crypto_util.cc#L63)
    do {
        if (1 == RAND_status()) {
            if (1 == RAND_bytes(bytes, length)) {
                return true;
            }
        }
    } while (1 == RAND_poll());

    return false;
}

NODE_API_ADDON(BlstTsAddon)
