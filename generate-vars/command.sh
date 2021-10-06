#!/usr/bin/env bash

set -e

event_name=$1
command_from_input=$2

if [ "$event_name" == 'push' ]; then
    command="publish"
elif [ "$event_name" == 'pull_request' ]; then
    command="build"
else
    command=$command_from_input
fi

echo $command