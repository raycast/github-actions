#!/usr/bin/env bash

set -e -o noglob

if [ -z "$1" ]; then
    echo "Command not provided"
    exit 1
else
    command=$1
fi

if [ -z "$2" ]; then
    echo "Paths not provided"
    exit 1
else
    declare -a 'paths=('"$2"')'
fi

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
ray_command_from_string $command

printf "🤖 %d extensions found\n" "${#paths[@]}"
printf '%s\n' "${paths[@]}"

printf "🤖 Downloading JSON scheme"
scheme_path="/tmp/raycast/extensions.json"
curl https://www.raycast.com/schemas/extension.json --create-dirs -o $scheme_path

starting_dir=$PWD
ray_full_command="ray $ray_command -s $scheme_path --exitOnError"
ray_cli_log_file="/tmp/capture.out"

exit_code=0

for dir in "${paths[@]}" ; do
    extension_folder=`basename $dir`
    printf "\nEntering $dir\n"
    cd "$dir"
    npm install
    printf "Executing '$ray_full_command'\n"
    set +e
    $ray_full_command 2>&1 | tee $ray_cli_log_file ; test ${PIPESTATUS[0]} -eq 0
    last_exit_code=${?}
    set -e
    if [ $exit_code == 0 ]; then
        exit_code=$last_exit_code
    fi
    if [ $last_exit_code -ne 0 ]; then
        error_message=`tr '\n' ' ' < $ray_cli_log_file`
        echo "::error title=$command failed for $extension_folder::$error_message"
    fi
    cd $starting_dir
done


exit $exit_code