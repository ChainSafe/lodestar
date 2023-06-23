#ifndef BLST_TS_SIGNATURE_H__
#define BLST_TS_SIGNATURE_H__

#include <memory>

#include "addon.h"
#include "blst.hpp"
#include "napi.h"

#define BLST_TS_SIGNATURE_LENGTH_COMPRESSED 96U
#define BLST_TS_SIGNATURE_LENGTH_UNCOMPRESSED 192U

class Signature : public Napi::ObjectWrap<Signature> {
   public:
    bool _has_jacobian;
    bool _has_affine;
    std::shared_ptr<blst::P2> _jacobian;
    std::shared_ptr<blst::P2_Affine> _affine;

    static void Init(Napi::Env env, Napi::Object &exports, BlstTsAddon *module);
    static Napi::Value Deserialize(const Napi::CallbackInfo &info);
    Signature(const Napi::CallbackInfo &info);
    Napi::Value Serialize(const Napi::CallbackInfo &info);
    Napi::Value SigValidate(const Napi::CallbackInfo &info);
};

#endif /* BLST_TS_SIGNATURE_H__ */