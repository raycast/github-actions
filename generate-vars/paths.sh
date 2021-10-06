#!/usr/bin/env bash

set -e -o noglob

event_name=$1
all_modified_files=$2
input_paths=$3

if [ "$event_name" != 'workflow_dispatch' ] ; then
    paths="$all_modified_files"
else
    paths="$input_paths"
fi

echo $paths