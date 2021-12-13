#!/usr/bin/env bash

set -e

version=$1
access_token=$2
api_url=$3

if test "$#" -eq 3; then
    path=~/.config/raycast-debug
    mkdir -p $path
    config_file_path=$path/config.json
    echo "Generate config $config_file_path"
    jq -n --arg accesstoken "$access_token" --arg apiurl "$api_url" '{"accesstoken": $accesstoken, "apiurl": $apiurl}' > $config_file_path
elif test "$#" -ne 1; then
    echo "Usage: setup_cli.sh version access_token api_url"
    exit 1
fi

cli_url="https://raycast-cli.s3.eu-central-1.amazonaws.com/linux/ray-v$version"
target_path="/usr/local/bin/ray"
echo "Downloading: $cli_url"
if ! wget -q -O $target_path $cli_url; then
    echo "Failed downloading $cli_url"
    exit 1
fi
chmod +x $target_path
ray version
