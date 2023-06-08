#include "addon.h"

void Signature::Init(Napi::Env env, Napi::Object &exports, BlstTsAddon *module)
{
    Napi::HandleScope scope(env); // no need to Escape, Persistent will take care of it
    auto proto = {
        StaticMethod("deserialize", &Signature::Deserialize, static_cast<napi_property_attributes>(napi_static | napi_enumerable)),
        InstanceMethod("serialize", &Signature::Serialize, static_cast<napi_property_attributes>(napi_enumerable)),
        InstanceMethod("sigValidate", &Signature::SigValidate, static_cast<napi_property_attributes>(napi_enumerable)),
        InstanceMethod("sigValidateSync", &Signature::SigValidateSync, static_cast<napi_property_attributes>(napi_enumerable)),
    };
    Napi::Function ctr = DefineClass(env, "Signature", proto, module);
    module->_signature_ctr = Napi::Persistent(ctr);
    module->_signature_tag = {BLST_TS_SIGNATURE_LOWER_TAG, BLST_TS_SIGNATURE_UPPER_TAG};
    exports.Set(Napi::String::New(env, "Signature"), ctr);
}

/**
 *
 *
 * Signature Workers
 *
 *
 */
namespace
{
    class SigValidateWorker : public BlstAsyncWorker
    {
    public:
        SigValidateWorker(
            const Napi::CallbackInfo &info,
            bool has_jacobian,
            bool has_affine,
            blst::P2 *jacobian,
            blst::P2_Affine *affine)
            : BlstAsyncWorker(info),
              _has_jacobian{has_jacobian},
              _has_affine{has_affine},
              _jacobian{jacobian},
              _affine{affine} {};

    protected:
        void Setup() override{};

        void Execute() override
        {
            if (!_has_jacobian && !_has_affine)
            {
                SetError("Signature not initialized");
                return;
            }
            if (_has_jacobian && !_jacobian->in_group())
            {
                SetError("blst::BLST_POINT_NOT_IN_GROUP");
                return;
            }
            if (_has_affine && !_affine->in_group())
            {
                SetError("blst::BLST_POINT_NOT_IN_GROUP");
                return;
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
        blst::P2 *_jacobian;
        blst::P2_Affine *_affine;
    };
}

/**
 *
 *
 * Signature Methods
 *
 *
 */
Napi::Value Signature::Deserialize(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();
    Napi::EscapableHandleScope scope(env);
    BlstTsAddon *module = env.GetInstanceData<BlstTsAddon>();
    Napi::Object wrapped = module->_signature_ctr.New({Napi::External<void>::New(env, nullptr)});
    wrapped.TypeTag(&module->_signature_tag);
    Signature *sig = Signature::Unwrap(wrapped);
    // default to jacobian for now
    sig->_has_jacobian = true;
    // but figure out if request for affine
    if (!info[1].IsUndefined())
    {
        Napi::Value type_val = info[1].As<Napi::Value>();
        if (!type_val.IsNumber())
        {
            Napi::TypeError::New(env, "type must be of enum CoordType (number)").ThrowAsJavaScriptException();
            return scope.Escape(env.Undefined());
        }
        if (type_val.As<Napi::Number>().Uint32Value() == 0)
        {
            sig->_has_jacobian = false;
            sig->_has_affine = true;
        }
    }
    Uint8ArrayArg sig_bytes{env, info[0], "sigBytes"};
    sig_bytes.ValidateLength(
        BLST_TS_SIGNATURE_LENGTH_COMPRESSED,
        BLST_TS_SIGNATURE_LENGTH_UNCOMPRESSED);
    if (sig_bytes.HasError())
    {
        sig_bytes.ThrowJsException();
        return scope.Escape(env.Undefined());
    }
    try
    {
        if (sig->_has_jacobian)
        {
            sig->_jacobian.reset(new blst::P2{sig_bytes.Data(), sig_bytes.ByteLength()});
        }
        else
        {
            sig->_affine.reset(new blst::P2_Affine{sig_bytes.Data(), sig_bytes.ByteLength()});
        }
    }
    catch (blst::BLST_ERROR err)
    {
        Napi::RangeError::New(env, module->GetBlstErrorString(err)).ThrowAsJavaScriptException();
        return env.Undefined();
    }
    return scope.Escape(wrapped);
}

const blst::P2 *Signature::AsJacobian()
{
    if (!_has_jacobian && !_has_affine)
    {
        throw Napi::Error::New(BlstBase::_env, "Signature not initialized");
    }
    if (!_has_jacobian)
    {
        _jacobian.reset(new blst::P2{_affine->to_jacobian()});
        _has_jacobian = true;
    }
    return _jacobian.get();
}

const blst::P2_Affine *Signature::AsAffine()
{
    if (!_has_jacobian && !_has_affine)
    {
        throw Napi::Error::New(BlstBase::_env, "Signature not initialized");
    }
    if (!_has_affine)
    {
        _affine.reset(new blst::P2_Affine{_jacobian->to_affine()});
        _has_affine = true;
    }
    return _affine.get();
}

Signature::Signature(const Napi::CallbackInfo &info)
    : BlstBase{info.Env()},
      Napi::ObjectWrap<Signature>{info},
      _has_jacobian{false},
      _has_affine{false},
      _jacobian{nullptr},
      _affine{nullptr}
{
    Napi::HandleScope scope(BlstBase::_env);
    if (!info[0].IsExternal())
    {
        Napi::Error::New(BlstBase::_env, "Signature constructor is private").ThrowAsJavaScriptException();
        return;
    }
};

Napi::Value Signature::Serialize(const Napi::CallbackInfo &info)
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
            ? BLST_TS_SIGNATURE_LENGTH_COMPRESSED
            : BLST_TS_SIGNATURE_LENGTH_UNCOMPRESSED);
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
        Napi::Error::New(env, "Signature cannot be serialized. No point found!").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    return scope.Escape(serialized);
}

Napi::Value Signature::SigValidate(const Napi::CallbackInfo &info)
{
    Napi::EscapableHandleScope scope(info.Env());
    SigValidateWorker *worker = new SigValidateWorker{info,
                                                      _has_jacobian,
                                                      _has_affine,
                                                      _jacobian.get(),
                                                      _affine.get()};
    return scope.Escape(worker->Run());
}

Napi::Value Signature::SigValidateSync(const Napi::CallbackInfo &info)
{
    Napi::EscapableHandleScope scope(info.Env());
    SigValidateWorker worker{info,
                             _has_jacobian,
                             _has_affine,
                             _jacobian.get(),
                             _affine.get()};
    return scope.Escape(worker.RunSync());
}

/**
 *
 *
 * SignatureArg
 *
 *
 */
SignatureArg::SignatureArg(Napi::Env env)
    : BlstBase{env},
      _signature{nullptr},
      _bytes{_env} {};

SignatureArg::SignatureArg(Napi::Env env, Napi::Value raw_arg)
    : SignatureArg{env}
{
    Napi::HandleScope scope(_env);
    if (raw_arg.IsTypedArray())
    {
        _bytes = Uint8ArrayArg{_env, raw_arg, "SignatureArg"};
        _bytes.ValidateLength(
            BLST_TS_SIGNATURE_LENGTH_COMPRESSED,
            BLST_TS_SIGNATURE_LENGTH_UNCOMPRESSED);
        if (_bytes.HasError())
        {
            // goto set_error to get more specific error message
            // instead of Uint8Array error message
            goto set_error;
        }
        Napi::Object wrapped = _module->_signature_ctr.New({Napi::External<void *>::New(_env, nullptr)});
        wrapped.TypeTag(&_module->_signature_tag);
        _ref = Napi::Persistent(raw_arg);
        _signature = Signature::Unwrap(wrapped);
        try
        {
            _signature->_jacobian.reset(new blst::P2{_bytes.Data(), _bytes.ByteLength()});
        }
        catch (blst::BLST_ERROR &err)
        {
            std::ostringstream msg;
            msg << _module->GetBlstErrorString(err) << ": Invalid Signature";
            SetError(msg.str());
            return;
        }
        _signature->_has_jacobian = true;
        return;
    }
    if (raw_arg.IsObject())
    {
        Napi::Object raw_obj = raw_arg.As<Napi::Object>();
        if (raw_obj.CheckTypeTag(&_module->_signature_tag))
        {
            _ref = Napi::Persistent(raw_arg);
            _signature = Signature::Unwrap(raw_obj);
            return;
        }
    }

set_error:
    SetError("SignatureArg must be a Signature instance or a 96/192 byte Uint8Array");
};

const blst::P2 *SignatureArg::AsJacobian()
{
    return _signature->AsJacobian();
}

const blst::P2_Affine *SignatureArg::AsAffine()
{
    return _signature->AsAffine();
}

/**
 *
 *
 * SignatureArgArray
 *
 *
 */
SignatureArgArray::SignatureArgArray(Napi::Env env, Napi::Value raw_arg)
    : BlstBase{env},
      _signatures{}
{
    Napi::HandleScope scope(_env);
    if (!raw_arg.IsArray())
    {
        SetError("signatures must be of type SignatureArg[]");
        return;
    }
    Napi::Array arr = raw_arg.As<Napi::Array>();
    uint32_t length = arr.Length();
    _signatures.reserve(length);
    for (uint32_t i = 0; i < length; i++)
    {
        _signatures.push_back(SignatureArg{env, arr[i]});
        if (_signatures[i].HasError())
        {
            std::ostringstream msg;
            msg << _signatures[i].GetError() << " at index " << i;
            SetError(msg.str());
            return;
        }
    }
}
