#!/usr/bin/env bash

set -e

version=$1
access_token=$2
api_url=$3

if test "$#" -ne 3; then
    echo "Usage: setup_cli.sh version access_token api_url"
    exit 1
fi

path=~/.config/raycast-debug
mkdir -p $path
config_file_path=$path/config.json
jq -n --arg accesstoken "$access_token" --arg apiurl "$api_url" '{"accesstoken": $accesstoken, "apiurl": $apiurl}' > $config_file_path
cli_url="https://raycast-cli.s3.eu-central-1.amazonaws.com/linux/ray-v$version"
target_path="/usr/local/bin/ray"
echo "Downloading: $cli_url"
if ! wget -q -O $target_path $cli_url; then
    echo "Failed downloading $cli_url"
    exit 1
fi
chmod +x $target_path
ray version