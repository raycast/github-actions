#!/usr/bin/env bash

set -e

version=$1
access_token=$2

if test "$#" -eq 2; then
    path=~/.config/raycast-debug
    mkdir -p $path
    config_file_path=$path/config.json
    echo "Generate config $config_file_path"
    jq -n --arg accesstoken "$access_token" '{"accesstoken": $accesstoken}' > $config_file_path
elif test "$#" -ne 1; then
    echo "Usage: setup_cli.sh version access_token"
    exit 1
fi

cli_url="https://raycast-cli.s3.eu-central-1.amazonaws.com/$version/linux/ray"
target_path="/usr/local/bin/ray"
echo "Downloading: $cli_url"
if ! wget -q -O $target_path $cli_url; then
    echo "Failed downloading $cli_url"
    exit 1
fi
chmod +x $target_path
ray version
