#include "addon.h"

void SecretKey::Init(Napi::Env env, Napi::Object &exports, BlstTsAddon *module)
{
    Napi::HandleScope scope(env); // no need to Escape, Persistent will take care of it
    auto proto = {
        StaticMethod("fromKeygen", &SecretKey::FromKeygen, static_cast<napi_property_attributes>(napi_static | napi_enumerable)),
        StaticMethod("fromKeygenSync", &SecretKey::FromKeygenSync, static_cast<napi_property_attributes>(napi_static | napi_enumerable)),
        StaticMethod("deserialize", &SecretKey::Deserialize, static_cast<napi_property_attributes>(napi_static | napi_enumerable)),
        InstanceMethod("serialize", &SecretKey::Serialize, static_cast<napi_property_attributes>(napi_enumerable)),
        InstanceMethod("toPublicKey", &SecretKey::ToPublicKey, static_cast<napi_property_attributes>(napi_enumerable)),
        InstanceMethod("sign", &SecretKey::Sign, static_cast<napi_property_attributes>(napi_enumerable)),
        InstanceMethod("signSync", &SecretKey::SignSync, static_cast<napi_property_attributes>(napi_enumerable))};
    Napi::Function ctr = DefineClass(env, "SecretKey", proto, module);
    module->_secret_key_ctr = Napi::Persistent(ctr);
    module->_secret_key_tag = {BLST_TS_SECRET_KEY_LOWER_TAG, BLST_TS_SECRET_KEY_UPPER_TAG};
    exports.Set(Napi::String::New(env, "SecretKey"), ctr);
}

/**
 *
 *
 * SecretKey Workers
 *
 *
 */
namespace
{
    class FromKeygenWorker : public BlstAsyncWorker
    {
    public:
        FromKeygenWorker(const Napi::CallbackInfo &info)
            : BlstAsyncWorker(info),
              _key{},
              _entropy{_env},
              _info_str{},
              _is_zero_key{false} {};

        void Setup() override
        {
            if (!_info[0].IsUndefined()) // no entropy passed
            {
                _entropy = Uint8ArrayArg{_env, _info[0], "ikm"};
                _entropy.ValidateLength(BLST_TS_SECRET_KEY_LENGTH);
                if (_entropy.HasError())
                {
                    SetError(_entropy.GetError());
                    return;
                }
            }
            if (_info[1].IsUndefined())
            {
                return;
            }
            if (!_info[1].IsString())
            {
                SetError("info must be a string or undefined");
                return;
            }
            // no way to not do the data copy here.  `.Utf8Value()` uses napi_env
            // and has to be run on-thread. copy the string we shall... sigh.
            _info_str.append(_info[1].As<Napi::String>().Utf8Value());
        };

        /**
         * The keygen function defaults to empty string so just pass in the
         * the info string. Is initialized to empty string if not passed.
         */
        void Execute() override
        {
            if (_entropy.Data() == nullptr)
            {
                blst::byte ikm[BLST_TS_SECRET_KEY_LENGTH];
                _module->GetRandomBytes(ikm, BLST_TS_SECRET_KEY_LENGTH);
                _key.keygen(ikm, BLST_TS_SECRET_KEY_LENGTH, _info_str);
                return;
            }
            _key.keygen(_entropy.Data(), BLST_TS_SECRET_KEY_LENGTH, _info_str);
            blst::byte key_bytes[BLST_TS_SECRET_KEY_LENGTH];
            _key.to_bendian(key_bytes);
            if (this->IsZeroBytes(key_bytes, 0, BLST_TS_SECRET_KEY_LENGTH))
            {
                _is_zero_key = true;
            }
        };

        Napi::Value GetReturnValue() override
        {
            Napi::EscapableHandleScope scope(_env);
            Napi::Object wrapped = _module->_secret_key_ctr.New({Napi::External<void *>::New(Env(), nullptr)});
            wrapped.TypeTag(&_module->_secret_key_tag);
            SecretKey *sk = SecretKey::Unwrap(wrapped);
            sk->_key.reset(new blst::SecretKey{_key});
            if (_is_zero_key)
            {
                sk->_is_zero_key = true;
            }
            return scope.Escape(wrapped);
        };

    private:
        blst::SecretKey _key;
        Uint8ArrayArg _entropy;
        std::string _info_str;
        bool _is_zero_key;
    };

    class SignWorker : public BlstAsyncWorker
    {
    public:
        SignWorker(
            const Napi::CallbackInfo &info,
            const blst::SecretKey &key,
            const bool is_zero_key)
            : BlstAsyncWorker{info},
              _key{key},
              _is_zero_key{is_zero_key},
              _point{},
              _msg{_env, info[0], "msg to sign"} {};
        void Setup() override{};
        void Execute() override
        {
            if (_is_zero_key)
            {
                return;
            }
            _point.hash_to(_msg.Data(), _msg.ByteLength(), _module->_dst);
            _point.sign_with(_key);
        };
        Napi::Value GetReturnValue() override
        {
            Napi::EscapableHandleScope scope(_env);
            if (_is_zero_key)
            {
                return scope.Escape(_env.Null());
            }
            Napi::Object wrapped = _module->_signature_ctr.New({Napi::External<void *>::New(Env(), nullptr)});
            wrapped.TypeTag(&_module->_signature_tag);
            Signature *sig = Signature::Unwrap(wrapped);
            sig->_jacobian.reset(new blst::P2{_point});
            sig->_has_jacobian = true;
            return scope.Escape(wrapped);
        };

    private:
        const blst::SecretKey &_key;
        const bool _is_zero_key;
        blst::P2 _point;
        Uint8ArrayArg _msg;
    };
} // namespace (anonymous)

/**
 *
 *
 * SecretKey
 *
 *
 */
Napi::Value SecretKey::FromKeygen(const Napi::CallbackInfo &info)
{
    Napi::EscapableHandleScope scope(info.Env());
    FromKeygenWorker *worker = new FromKeygenWorker{info};
    return scope.Escape(worker->Run());
}

Napi::Value SecretKey::FromKeygenSync(const Napi::CallbackInfo &info)
{
    Napi::EscapableHandleScope scope(info.Env());
    FromKeygenWorker worker{info};
    return scope.Escape(worker.RunSync());
}

Napi::Value SecretKey::Deserialize(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();
    Napi::EscapableHandleScope scope(env);
    BlstTsAddon *module = env.GetInstanceData<BlstTsAddon>();
    Napi::Object wrapped = module->_secret_key_ctr.New({Napi::External<void>::New(env, nullptr)});
    wrapped.TypeTag(&module->_secret_key_tag);
    SecretKey *sk = SecretKey::Unwrap(wrapped);
    Uint8ArrayArg skBytes{env, info[0], "skBytes"};
    skBytes.ValidateLength(BLST_TS_SECRET_KEY_LENGTH);
    if (skBytes.HasError())
    {
        skBytes.ThrowJsException();
        return env.Undefined();
    }
    sk->_key->from_bendian(skBytes.Data());
    if (skBytes.IsZeroBytes(skBytes.Data(), 0, skBytes.ByteLength()))
    {
        sk->_is_zero_key = true;
    }
    return scope.Escape(wrapped);
}

SecretKey::SecretKey(const Napi::CallbackInfo &info)
    : Napi::ObjectWrap<SecretKey>{info},
      _key{new blst::SecretKey},
      _is_zero_key{false},
      _module{reinterpret_cast<BlstTsAddon *>(info.Data())}
{
    Napi::Env env = info.Env();
    if (!info[0].IsExternal())
    {
        Napi::Error::New(env, "SecretKey constructor is private").ThrowAsJavaScriptException();
        return;
    }
};

Napi::Value SecretKey::Serialize(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();
    Napi::EscapableHandleScope scope(env);
    Napi::Buffer<uint8_t> serialized = Napi::Buffer<uint8_t>::New(env, BLST_TS_SECRET_KEY_LENGTH);
    _key->to_bendian(serialized.Data());
    return scope.Escape(serialized);
}

Napi::Value SecretKey::ToPublicKey(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();
    Napi::EscapableHandleScope scope(env);
    Napi::Object wrapped = _module->_public_key_ctr.New({Napi::External<void *>::New(Env(), nullptr)});
    wrapped.TypeTag(&_module->_public_key_tag);
    PublicKey *pk = PublicKey::Unwrap(wrapped);
    pk->_jacobian.reset(new blst::P1{*_key});
    pk->_has_jacobian = true;
    return scope.Escape(wrapped);
}

Napi::Value SecretKey::Sign(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();
    Napi::EscapableHandleScope scope(env);
    SignWorker *worker = new SignWorker{info, *_key, _is_zero_key};
    return scope.Escape(worker->Run());
}

Napi::Value SecretKey::SignSync(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();
    Napi::EscapableHandleScope scope(env);
    SignWorker worker{info, *_key, _is_zero_key};
    return scope.Escape(worker.RunSync());
}
