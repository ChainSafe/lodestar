#include "addon.h"

void PublicKey::Init(Napi::Env env, Napi::Object &exports, BlstTsAddon *module)
{
    Napi::HandleScope scope(env); // no need to Escape, Persistent will take care of it
    auto proto = {
        StaticMethod("deserialize", &PublicKey::Deserialize, static_cast<napi_property_attributes>(napi_static | napi_enumerable)),
        InstanceMethod("serialize", &PublicKey::Serialize, static_cast<napi_property_attributes>(napi_enumerable)),
        InstanceMethod("keyValidate", &PublicKey::KeyValidate, static_cast<napi_property_attributes>(napi_enumerable)),
        InstanceMethod("keyValidateSync", &PublicKey::KeyValidateSync, static_cast<napi_property_attributes>(napi_enumerable)),
    };
    Napi::Function ctr = DefineClass(env, "PublicKey", proto, module);
    module->_public_key_ctr = Napi::Persistent(ctr);
    module->_public_key_tag = {BLST_TS_PUBLIC_KEY_LOWER_TAG, BLST_TS_PUBLIC_KEY_UPPER_TAG};
    exports.Set(Napi::String::New(env, "PublicKey"), ctr);
}

/**
 *
 *
 * PublicKey Workers
 *
 *
 */
namespace
{
    class KeyValidateWorker : public BlstAsyncWorker
    {
    public:
        KeyValidateWorker(
            const Napi::CallbackInfo &info,
            bool has_jacobian,
            bool has_affine,
            blst::P1 *jacobian,
            blst::P1_Affine *affine)
            : BlstAsyncWorker(info),
              _has_jacobian{has_jacobian},
              _has_affine{has_affine},
              _jacobian{jacobian},
              _affine{affine} {};

    protected:
        void Setup() override{};

        void Execute() override
        {
            if (_has_jacobian)
            {
                if (_jacobian->is_inf())
                {
                    SetError("blst::BLST_PK_IS_INFINITY");
                    return;
                }
                if (!_jacobian->in_group())
                {
                    SetError("blst::BLST_POINT_NOT_IN_GROUP");
                    return;
                }
            }
            else if (_has_affine)
            {
                if (_affine->is_inf())
                {
                    SetError("blst::BLST_PK_IS_INFINITY");
                    return;
                }
                if (!_affine->in_group())
                {
                    SetError("blst::BLST_POINT_NOT_IN_GROUP");
                    return;
                }
            }
            else
            {
                SetError("blst::BLST_PK_IS_INFINITY");
            }
        };

        Napi::Value GetReturnValue() override
        {
            Napi::EscapableHandleScope scope(_env);
            return scope.Escape(_env.Undefined());
        };

    private:
        bool _has_jacobian;
        bool _has_affine;
        blst::P1 *_jacobian;
        blst::P1_Affine *_affine;
    };
}

/**
 *
 *
 * PublicKey Methods
 *
 *
 */
Napi::Value PublicKey::Deserialize(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();
    Napi::EscapableHandleScope scope(env);
    BlstTsAddon *module = env.GetInstanceData<BlstTsAddon>();
    Napi::Object wrapped = module->_public_key_ctr.New({Napi::External<void>::New(env, nullptr)});
    wrapped.TypeTag(&module->_public_key_tag);
    PublicKey *pk = PublicKey::Unwrap(wrapped);
    // default to jacobian for now
    pk->_has_jacobian = true;
    // but figure out if request for affine
    if (!info[1].IsUndefined())
    {
        Napi::Value type_val = info[1].As<Napi::Value>();
        if (!type_val.IsNumber())
        {
            Napi::TypeError::New(env, "type must be of enum CoordType (number)").ThrowAsJavaScriptException();
            return env.Undefined();
        }
        if (type_val.As<Napi::Number>().Uint32Value() == 0)
        {
            pk->_has_jacobian = false;
            pk->_has_affine = true;
        }
    }
    Uint8ArrayArg pk_bytes{env, info[0], "pkBytes"};
    pk_bytes.ValidateLength(BLST_TS_PUBLIC_KEY_LENGTH_COMPRESSED,
                            BLST_TS_PUBLIC_KEY_LENGTH_UNCOMPRESSED);
    if (pk_bytes.HasError())
    {
        pk_bytes.ThrowJsException();
        return env.Undefined();
    }
    try
    {
        if (pk->_has_jacobian)
        {
            pk->_jacobian.reset(new blst::P1{pk_bytes.Data(), pk_bytes.ByteLength()});
        }
        else
        {
            pk->_affine.reset(new blst::P1_Affine{pk_bytes.Data(), pk_bytes.ByteLength()});
        }
    }
    catch (blst::BLST_ERROR err)
    {
        Napi::RangeError::New(env, module->GetBlstErrorString(err)).ThrowAsJavaScriptException();
        return env.Undefined();
    }
    return scope.Escape(wrapped);
}

PublicKey::PublicKey(const Napi::CallbackInfo &info)
    : BlstBase{info.Env()},
      Napi::ObjectWrap<PublicKey>{info},
      _is_zero_key{false},
      _has_jacobian{false},
      _has_affine{false},
      _jacobian{nullptr},
      _affine{nullptr}
{
    Napi::HandleScope scope(BlstBase::_env);
    if (!info[0].IsExternal())
    {
        Napi::Error::New(BlstBase::_env, "PublicKey constructor is private").ThrowAsJavaScriptException();
        return;
    }
};

Napi::Value PublicKey::Serialize(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();
    Napi::EscapableHandleScope scope(env);
    bool compressed{true};
    if (!info[0].IsUndefined())
    {
        compressed = info[0].ToBoolean().Value();
    }
    Napi::Buffer<uint8_t> serialized = Napi::Buffer<uint8_t>::New(
        env,
        compressed
            ? BLST_TS_PUBLIC_KEY_LENGTH_COMPRESSED
            : BLST_TS_PUBLIC_KEY_LENGTH_UNCOMPRESSED);
    if (_has_jacobian)
    {
        compressed ? _jacobian->compress(serialized.Data()) : _jacobian->serialize(serialized.Data());
    }
    else if (_has_affine)
    {
        compressed ? _affine->compress(serialized.Data()) : _affine->serialize(serialized.Data());
    }
    else
    {
        Napi::Error::New(env, "PublicKey cannot be serialized. No point found!").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    return scope.Escape(serialized);
}

Napi::Value PublicKey::KeyValidate(const Napi::CallbackInfo &info)
{
    Napi::EscapableHandleScope scope(info.Env());
    KeyValidateWorker *worker = new KeyValidateWorker{
        info,
        _has_jacobian,
        _has_affine,
        _jacobian.get(),
        _affine.get()};
    return scope.Escape(worker->Run());
}

Napi::Value PublicKey::KeyValidateSync(const Napi::CallbackInfo &info)
{
    Napi::EscapableHandleScope scope(info.Env());
    KeyValidateWorker worker{
        info,
        _has_jacobian,
        _has_affine,
        _jacobian.get(),
        _affine.get()};
    return scope.Escape(worker.RunSync());
}

const blst::P1 *PublicKey::AsJacobian()
{
    if (!_has_jacobian && !_has_affine)
    {
        throw Napi::Error::New(BlstBase::_env, "PublicKey not initialized");
    }
    if (!_has_jacobian)
    {
        _jacobian.reset(new blst::P1{_affine->to_jacobian()});
        _has_jacobian = true;
    }
    return _jacobian.get();
}

const blst::P1_Affine *PublicKey::AsAffine()
{
    if (!_has_jacobian && !_has_affine)
    {
        throw Napi::Error::New(BlstBase::_env, "PublicKey not initialized");
    }
    if (!_has_affine)
    {
        _affine.reset(new blst::P1_Affine{_jacobian->to_affine()});
        _has_affine = true;
    }
    return _affine.get();
}

bool PublicKey::NativeValidate()
{
    if (_has_jacobian && !_jacobian->is_inf() && _jacobian->in_group())
    {
        return true;
    }
    else if (_has_affine && !_affine->is_inf() && _affine->in_group())
    {
        return true;
    }
    return false;
}

/**
 *
 *
 * PublicKeyArg
 *
 *
 */
PublicKeyArg::PublicKeyArg(Napi::Env env)
    : BlstBase{env},
      _public_key{nullptr},
      _bytes{_env} {};

PublicKeyArg::PublicKeyArg(Napi::Env env, Napi::Value raw_arg)
    : PublicKeyArg{env}
{
    Napi::HandleScope scope(_env);
    if (raw_arg.IsTypedArray())
    {
        _bytes = Uint8ArrayArg{_env, raw_arg, "PublicKeyArg"};
        _bytes.ValidateLength(
            BLST_TS_PUBLIC_KEY_LENGTH_COMPRESSED,
            BLST_TS_PUBLIC_KEY_LENGTH_UNCOMPRESSED);
        if (_bytes.HasError())
        {
            // goto set_error to get more specific error message
            // instead of Uint8Array error message
            goto set_error;
        }
        Napi::Object wrapped = _module->_public_key_ctr.New({Napi::External<void *>::New(_env, nullptr)});
        wrapped.TypeTag(&_module->_public_key_tag);
        _ref = Napi::Persistent(wrapped);
        _public_key = PublicKey::Unwrap(wrapped);
        if (_bytes.IsZeroBytes(_bytes.Data(), 0, _bytes.ByteLength()))
        {
            _public_key->_jacobian.reset(new blst::P1{});
            _public_key->_is_zero_key = true;
        }
        else
        {
            try
            {
                _public_key->_jacobian.reset(new blst::P1{_bytes.Data(), _bytes.ByteLength()});
            }
            catch (blst::BLST_ERROR &err)
            {
                std::ostringstream msg;
                msg << _module->GetBlstErrorString(err) << ": Invalid PublicKey";
                SetError(msg.str());
                return;
            }
        }
        _public_key->_has_jacobian = true;
        return;
    }
    if (raw_arg.IsObject())
    {
        Napi::Object raw_obj = raw_arg.As<Napi::Object>();
        if (raw_obj.CheckTypeTag(&_module->_public_key_tag))
        {
            _ref = Napi::Persistent(raw_obj);
            _public_key = PublicKey::Unwrap(raw_obj);
            return;
        }
    }

set_error:
    SetError("PublicKeyArg must be a PublicKey instance or a 48/96 byte Uint8Array");
};

const blst::P1 *PublicKeyArg::AsJacobian()
{
    return _public_key->AsJacobian();
}

const blst::P1_Affine *PublicKeyArg::AsAffine()
{
    return _public_key->AsAffine();
}

/**
 *
 *
 * PublicKeyArgArray
 *
 *
 */
PublicKeyArgArray::PublicKeyArgArray(Napi::Env env, Napi::Value raw_arg)
    : BlstBase{env},
      _keys{}
{
    Napi::HandleScope scope(_env);
    if (!raw_arg.IsArray())
    {
        SetError("publicKeys must be of type PublicKeyArg[]");
        return;
    }
    Napi::Array arr = raw_arg.As<Napi::Array>();
    uint32_t length = arr.Length();
    _keys.reserve(length);
    for (uint32_t i = 0; i < length; i++)
    {
        _keys.push_back(PublicKeyArg{env, arr[i]});
        if (_keys[i].HasError())
        {
            std::ostringstream msg;
            msg << _keys[i].GetError() << " at index " << i;
            SetError(msg.str());
            _bad_index = i;
            return;
        }
    }
}
