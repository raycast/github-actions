#!/usr/bin/env bash

set -e

access_token=$1
api_url=$2

if [ -n "${access_token}" ] && [ -n "${api_url}" ]; then
    path=~/.config/raycast-debug
    mkdir -p $path
    config_file_path=$path/config.json
    jq -n --arg accesstoken "$access_token" --arg apiurl "$api_url" '{"accesstoken": $accesstoken, "apiurl": $apiurl}' > $config_file_path
fi

wget -q -O "/usr/local/bin/ray" "https://raycast-cli.s3.eu-central-1.amazonaws.com/linux/ray"
wait
chmod +x "/usr/local/bin/ray"
ray version