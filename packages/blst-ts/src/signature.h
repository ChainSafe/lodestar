#ifndef BLST_TS_SIGNATURE_H__
#define BLST_TS_SIGNATURE_H__

#include <memory>
#include "napi.h"
#include "blst.hpp"
#include "addon.h"

class Signature : public BlstBase, public Napi::ObjectWrap<Signature>
{
public:
    bool _has_jacobian;
    bool _has_affine;
    std::unique_ptr<blst::P2> _jacobian;
    std::unique_ptr<blst::P2_Affine> _affine;

    static void Init(Napi::Env env, Napi::Object &exports, BlstTsAddon *module);
    static Napi::Value Deserialize(const Napi::CallbackInfo &info);
    Signature(const Napi::CallbackInfo &info);
    Napi::Value Serialize(const Napi::CallbackInfo &info);
    Napi::Value SigValidate(const Napi::CallbackInfo &info);
    Napi::Value SigValidateSync(const Napi::CallbackInfo &info);

    const blst::P2 *AsJacobian();
    const blst::P2_Affine *AsAffine();
};

class SignatureArg : public BlstBase
{
public:
    Signature *_signature;
    
    SignatureArg(Napi::Env env);
    SignatureArg(Napi::Env env, Napi::Value raw_arg);
    SignatureArg(const SignatureArg &source) = delete;
    SignatureArg(SignatureArg &&source) = default;

    SignatureArg &operator=(const SignatureArg &source) = delete;
    SignatureArg &operator=(SignatureArg &&source) = default;

    const blst::P2 *AsJacobian();
    const blst::P2_Affine *AsAffine();

private:
    Uint8ArrayArg _bytes;
    Napi::Reference<Napi::Value> _ref;
};

class SignatureArgArray : public BlstBase
{
public:
    SignatureArgArray(Napi::Env env, Napi::Value raw_arg);
    SignatureArgArray(const SignatureArgArray &source) = delete;
    SignatureArgArray(SignatureArgArray &&source) = default;

    SignatureArgArray &operator=(const SignatureArgArray &source) = delete;
    SignatureArgArray &operator=(SignatureArgArray &&source) = default;
    SignatureArg &operator[](size_t index) { return _signatures[index]; }

    size_t Size() { return _signatures.size(); }
    void Reserve(size_t size) { return _signatures.reserve(size); }

private:
    std::vector<SignatureArg> _signatures;
};


#endif /* BLST_TS_SIGNATURE_H__ */