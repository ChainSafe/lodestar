#ifndef BLST_TS_FUNCTIONS_H__
#define BLST_TS_FUNCTIONS_H__

#include <sstream>
#include <vector>
#include <memory>
#include "napi.h"
#include "blst.hpp"
#include "addon.h"

namespace Functions
{
    void Init(const Napi::Env &env, Napi::Object &exports);
}

#endif /* BLST_TS_FUNCTIONS_H__ */
