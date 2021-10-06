#!/usr/bin/env bash

set -e

command=$1
paths=$2
workspace_dir=${GITHUB_WORKSPACE}

function ray_command_from_string() {
    case $1 in
        build)
        ray_command="build -e dist"
        ;;

        publish)
        ray_command="publish -f"
        ;;

        *)
        echo "Unsupported command. 'build' | 'publish'"
        return 1
        ;;
    esac
}

starting_dir=$PWD
ray_command_from_string $command
declare -a 'directories=('"$paths"')'

declare -a extension_changed=()
for dir in "${directories[@]}" ; do
    search_dir="$workspace_dir/$dir"
    while [ "$search_dir" != $(dirname "$search_dir") ];
    do
        if [ -d "$search_dir" ]; then
            package_json_file="$search_dir/package.json"
            if [ -f $package_json_file ]; then
                if grep -q "commands" $package_json_file; then
                    if grep -q "raycast" $package_json_file; then
                        if [[ ! " ${extension_changed[@]} " =~ " ${search_dir} " ]]; then
                            extension_changed+=("$search_dir")
                        fi
                    fi
                fi
            fi
        fi
        search_dir=$(dirname "$search_dir")
    done
done

printf "🤖 %d Extensions found\n" "${#extension_changed[@]}"
printf '%s\n' "${extension_changed[@]}"

for dir in "${extension_changed[@]}" ; do
    printf "\nEntering $dir\n"
    cd "$dir"
    npm install
    printf "Executing 'ray $ray_command'\n"
    ray $ray_command --exitOnError
    cd $starting_dir
done
