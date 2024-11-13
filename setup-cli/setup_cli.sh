#!/usr/bin/env bash

set -e

version=$1
npm_token=$2

if [[ "$version" == *"alpha"* ]]; then
    if [ -z "$npm_token" ]; then
        echo "::error::Private api used without npm_token parameter"
        exit 1
    else
        echo "//npm.pkg.github.com/:_authToken=$npm_token" > ~/.npmrc
        echo "@raycast:registry=https://npm.pkg.github.com" >> ~/.npmrc
        echo "legacy-peer-deps=true" >> ~/.npmrc
        cleanup_npmrc=true
    fi
fi

# npm install doesn't allow us to silence output properly
# run it silently first and if it fails run it without silencing
set +e
npm install --global @raycast/api@$version --silent
last_exit_code=${?}
set -e

if [ $last_exit_code -ne 0 ]; then
    echo "::error::Npm install --global @raycast/api failed"
    set +e
    npm install --global @raycast/api@$version
    set -e
    exit 1
fi

# Cleanup `.npmrc`
if [ "$cleanup_npmrc" = true ] ; then
    rm ~/.npmrc
fi

ray version
