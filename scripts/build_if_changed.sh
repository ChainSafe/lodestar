#!/usr/bin/env bash

# Writes the last build time in packages/*/last_build_unixsec
# Then reads the file and checks if there has been any changes since then
# If so, do a build

# Exit on errors
set -e

LAST_BUILD_FILEPATH=.last_build_unixsec

# Check being run from a package directory
[ ! -d ./src ] && echo "Must be run in a package dir, no src"
[ ! -f ./package.json ] && echo "Must be run in a package dir, no package.json"

CURRENT_UNIXSEC=$(date +%s)

if [ -f "$LAST_BUILD_FILEPATH" ]; then
    # Exists
    LAST_BUILD_UNIXSEC=$(cat $LAST_BUILD_FILEPATH)
    SINCE_LAST_BUILD_SEC=$(($CURRENT_UNIXSEC - $LAST_BUILD_UNIXSEC))
    SINCE_LAST_BUILD_MIN=$(($SINCE_LAST_BUILD_SEC / 60 + 1))
    # Only with DEBUG=true, log math
    if [ ! -z "$DEBUG" ]; then
        echo "LAST_BUILD_UNIXSEC: $LAST_BUILD_UNIXSEC SINCE_LAST_BUILD_SEC: $SINCE_LAST_BUILD_SEC SINCE_LAST_BUILD_MIN: $SINCE_LAST_BUILD_MIN"
    fi
    
    CHANGED_FILES=$(find src package.json -cmin -$SINCE_LAST_BUILD_MIN)
    if [ -z "$CHANGED_FILES" ]; then
        # Empty, no changes
        SHOULD_BUILD=false
    else
        # Not empty, build
        SHOULD_BUILD=true
    fi
else
    # Does not exist, always build
    SHOULD_BUILD=true
fi

# If there are changes, build
if [ "$SHOULD_BUILD" = true ]; then
    npm run build
fi

# Persist current time after a successful build
echo $CURRENT_UNIXSEC > $LAST_BUILD_FILEPATH

