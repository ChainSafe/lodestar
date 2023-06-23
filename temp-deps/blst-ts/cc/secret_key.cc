#include "secret_key.h"

void SecretKey::Init(
    Napi::Env env, Napi::Object &exports, BlstTsAddon *module) {
    Napi::HandleScope scope(
        env);  // no need to EscapeHandleScope, Persistent will take care of it
    auto proto = {
        StaticMethod(
            "fromKeygen",
            &SecretKey::FromKeygen,
            static_cast<napi_property_attributes>(
                napi_static | napi_enumerable)),
        StaticMethod(
            "deserialize",
            &SecretKey::Deserialize,
            static_cast<napi_property_attributes>(
                napi_static | napi_enumerable)),
        InstanceMethod(
            "serialize",
            &SecretKey::Serialize,
            static_cast<napi_property_attributes>(napi_enumerable)),
        InstanceMethod(
            "toPublicKey",
            &SecretKey::ToPublicKey,
            static_cast<napi_property_attributes>(napi_enumerable)),
        InstanceMethod(
            "sign",
            &SecretKey::Sign,
            static_cast<napi_property_attributes>(napi_enumerable)),
    };

    Napi::Function ctr = DefineClass(env, "SecretKey", proto, module);
    module->_secret_key_ctr = Napi::Persistent(ctr);
    // These tag values must be unique across all classes
    module->_secret_key_tag = {0ULL, 1ULL};
    exports.Set(Napi::String::New(env, "SecretKey"), ctr);

    exports.Get("BLST_CONSTANTS")
        .As<Napi::Object>()
        .Set(
            Napi::String::New(env, "SECRET_KEY_LENGTH"),
            Napi::Number::New(env, BLST_TS_SECRET_KEY_LENGTH));
}

Napi::Value SecretKey::FromKeygen(const Napi::CallbackInfo &info) {
    BLST_TS_FUNCTION_PREAMBLE
    Napi::Value ikm_value = info[0];
    BLST_TS_UNWRAP_UINT_8_ARRAY(ikm_value, ikm, "ikm")
    if (ikm.ByteLength() < BLST_TS_SECRET_KEY_LENGTH) {
        std::ostringstream msg;
        msg << "ikm must be greater than or equal to "
            << BLST_TS_SECRET_KEY_LENGTH << " bytes";
        Napi::TypeError::New(env, msg.str()).ThrowAsJavaScriptException();
        return env.Undefined();
    }
    BLST_TS_CREAT_UNWRAPPED_OBJECT(secret_key, SecretKey, sk)

    // If `info` string is passed use it otherwise use default without. Is
    // optional parameter from blst library.
    if (!info[1].IsUndefined()) {
        if (!info[1].IsString()) {
            Napi::TypeError::New(env, "info must be a string")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        sk->_key->keygen(
            ikm.Data(),
            ikm.ByteLength(),
            info[1].As<Napi::String>().Utf8Value());
    } else {
        sk->_key->keygen(ikm.Data(), ikm.ByteLength());
    }

    // Check if key is zero and set flag if so. Several specs depend on this
    // check
    blst::byte key_bytes[BLST_TS_SECRET_KEY_LENGTH];
    sk->_key->to_bendian(key_bytes);
    if (is_zero_bytes(key_bytes, 0, BLST_TS_SECRET_KEY_LENGTH)) {
        sk->_is_zero_key = true;
    }

    return scope.Escape(wrapped);
}

Napi::Value SecretKey::Deserialize(const Napi::CallbackInfo &info) {
    BLST_TS_FUNCTION_PREAMBLE
    Napi::Value sk_bytes_value = info[0];
    BLST_TS_UNWRAP_UINT_8_ARRAY(sk_bytes_value, sk_bytes, "skBytes")
    std::string err_out{"skBytes"};
    if (!is_valid_length(
            err_out, sk_bytes.ByteLength(), BLST_TS_SECRET_KEY_LENGTH)) {
        Napi::TypeError::New(env, err_out).ThrowAsJavaScriptException();
        return scope.Escape(env.Undefined());
    }

    BLST_TS_CREAT_UNWRAPPED_OBJECT(secret_key, SecretKey, sk)
    // Deserialize key
    sk->_key->from_bendian(sk_bytes.Data());

    // Check if key is zero and set flag if so. Several specs depend on this
    // check
    blst::byte key_bytes[BLST_TS_SECRET_KEY_LENGTH];
    sk->_key->to_bendian(key_bytes);
    if (is_zero_bytes(key_bytes, 0, BLST_TS_SECRET_KEY_LENGTH)) {
        sk->_is_zero_key = true;
    }

    return scope.Escape(wrapped);
}

SecretKey::SecretKey(const Napi::CallbackInfo &info)
    : Napi::ObjectWrap<SecretKey>{info},
      _key{new blst::SecretKey},
      _is_zero_key{false} {
    Napi::Env env = info.Env();
    Napi::HandleScope scope(env);
    // Check that constructor was called from C++ and not JS. Externals can only
    // be created natively.
    if (!info[0].IsExternal()) {
        Napi::Error::New(env, "SecretKey constructor is private")
            .ThrowAsJavaScriptException();
        return;
    }
};

Napi::Value SecretKey::Serialize(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    Napi::EscapableHandleScope scope(env);

    Napi::Buffer<uint8_t> serialized =
        Napi::Buffer<uint8_t>::New(env, BLST_TS_SECRET_KEY_LENGTH);
    _key->to_bendian(serialized.Data());

    return scope.Escape(serialized);
}

Napi::Value SecretKey::ToPublicKey(const Napi::CallbackInfo &info) {
    BLST_TS_FUNCTION_PREAMBLE
    BLST_TS_CREAT_UNWRAPPED_OBJECT(public_key, PublicKey, pk)
    // Derive public key from secret key. Default to jacobian coordinates
    pk->_jacobian.reset(new blst::P1{*_key});
    pk->_has_jacobian = true;

    return scope.Escape(wrapped);
}

Napi::Value SecretKey::Sign(const Napi::CallbackInfo &info) {
    BLST_TS_FUNCTION_PREAMBLE

    // Check for zero key and throw error to meet spec requirements
    if (_is_zero_key) {
        Napi::TypeError::New(env, "cannot sign message with zero private key")
            .ThrowAsJavaScriptException();
        return scope.Escape(info.Env().Undefined());
    }

    Napi::Value msg_value = info[0];
    BLST_TS_UNWRAP_UINT_8_ARRAY(msg_value, msg, "msg")
    BLST_TS_CREAT_UNWRAPPED_OBJECT(signature, Signature, sig)
    // Default to jacobian coordinates
    sig->_jacobian.reset(new blst::P2);
    sig->_has_jacobian = true;
    // Hash to point and sign message
    sig->_jacobian->hash_to(msg.Data(), msg.ByteLength(), module->_dst);
    sig->_jacobian->sign_with(*_key);

    return scope.Escape(wrapped);
}
