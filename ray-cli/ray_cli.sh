#!/usr/bin/env bash

set -e -o noglob

if [ -z "$1" ]; then
    echo "Command not provided"
    exit 1
else
    command=$1
fi

if [ -z "$2" ]; then
    echo "::notice::No extensions to $command. Skipping RayCLI."
    exit 0
else
    IFS=$',' read -r -a paths <<< "$2"
fi

if [ ! -z "$3" ]; then
    export RAY_TOKEN=$3
    access_token=$3
fi

if [ ! -z "$4" ]; then
    extension_schema=$4
else
    extension_schema="https://www.raycast.com/schemas/extension.json"
fi

if [ ! -z "$5" ]; then
    SAVEIFS=$IFS
    IFS=$'\n'
    allow_owners_only_for_extensions=($5)
    IFS=$SAVEIFS
fi

if [ ! -z "$6" ]; then
    npmrc_path=$6
fi

if [ ! -z "$7" ]; then
    raycast_api_alpha_npm_token=$7
fi

function ray_command_from_string() {
    case $1 in
        build)
        ray_command="build -e dist"
        ray_validate_options="--skip-owner"
        ;;

        publish)
        ray_command="publish --skip-validation --skip-notify-raycast"
        ray_validate_options=""
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

starting_dir=$PWD
ray_validate="ray validate $ray_validate_options -s $extension_schema --non-interactive --emoji --exit-on-error"
ray_build_publish="ray $ray_command --non-interactive --emoji --exit-on-error"
ray_ci_log_file="/tmp/raycast/ray_cli.log"

mkdir -p $(dirname $ray_ci_log_file)
touch $ray_ci_log_file

last_exit_code=0
exit_code=$last_exit_code

declare -a 'store_urls'

for dir in "${paths[@]}" ; do
    extension_folder=`basename $dir`
    printf "\nEntering $dir\n"
    cd "$dir"

    ### Precheck package-lock existance for more readable errors
    if [ ! -f "./package-lock.json" ]; then
        echo "::error::Missing package-lock.json for $extension_folder"
        exit_code=1
        continue
    fi

    if [ -f "./yarn.lock" ]; then
        echo "::error::Remove yarn.lock for $extension_folder"
        exit_code=1
        continue
    fi

    git status -s

    ### Prevent 'owner' in package.json if needed
    if [ ! -z "${allow_owners_only_for_extensions}" ]; then
        if !(printf '%s\n' "${allow_owners_only_for_extensions[@]}" | grep -xq "$extension_folder"); then
            has_owner=$(jq 'has("owner")' package.json)
            if [ "$has_owner" == "true" ]; then
                echo "::error::We are restricting public organisation extensions for the moment. Ping \`@pernielsentikaer\` on Slack to discuss it. ($extension_folder)"
                exit_code=1
                continue
            fi
        else
            printf "Skipping 'owner' check for $extension_folder\n"
        fi
    fi

    ### Create .npmrc if needed
    cleanup_npmrc=false
    if [ ! -z "$npmrc_path" ]; then
        echo "Using npmrc from $npmrc_path"
        cp $npmrc_path .npmrc
        cleanup_npmrc=true
    else
        api_version=$(jq '.dependencies."@raycast/api"' package.json)
        if [[ "$api_version" == *"alpha"* ]]; then
            if [ -z "$raycast_api_alpha_npm_token" ]; then
                echo "::error::Alpha version of @raycast/api used without raycast_api_alpha_npm_token parameter"
                exit_code=1
                continue
            else
                echo "Generating .npmrc for alpha version of @raycast/api"
                echo "//npm.pkg.github.com/:_authToken=$raycast_api_alpha_npm_token" > .npmrc
                echo "@raycast:registry=https://npm.pkg.github.com" >> .npmrc
                echo "legacy-peer-deps=true" >> .npmrc
                cleanup_npmrc=true
            fi
        fi
    fi

    # npm ci doesn't allow us to silence output properly
    # run it silently first and if it fails run it without silencing
    set +e
    npm ci --silent
    last_exit_code=${?}
    set -e

    if [ $last_exit_code -ne 0 ]; then
        echo "::error::Npm ci failed for $extension_folder"
        set +e
        npm ci
        set -e
        exit_code=1
        continue
    fi

    ### Cleanup `.npmrc`
    if [ "$cleanup_npmrc" = true ] ; then
        rm .npmrc
    fi

    ### Validate
    set +e
    $ray_validate 2>&1 | tee $ray_ci_log_file ; test ${PIPESTATUS[0]} -eq 0
    last_exit_code=${?}
    set -e
    if [ $last_exit_code -eq 0 ]; then
        set +e
        $ray_build_publish 2>&1 | tee $ray_ci_log_file ; test ${PIPESTATUS[0]} -eq 0
        last_exit_code=${?}
        set -e
    fi

    #cleanup npm
    rm -rf ./node_modules

    if [ $exit_code -eq 0 ]; then
        exit_code=$last_exit_code
    fi
    if [ $last_exit_code -ne 0 ]; then
        error_message=`cat $ray_ci_log_file | tail -1`
        echo "::error title=$command failed for $extension_folder::$error_message"
    else
        if [ "$command" == "publish" ]; then
            author=`cat package.json | jq -r '.author | values'`
            owner=`cat package.json | jq -r '.owner | values'`
            name=`cat package.json | jq -r '.name | values'`
            if [ ! -z "$owner" ]
            then
                store_path="$owner/$name"
            else
                store_path="$author/$name"
            fi
            store_url="https://raycast.com/$store_path"
            store_urls+=("$store_url")
        fi
    fi
    cd $starting_dir
done

# encode multiline output for github actions
{
    echo 'store_urls<<EOF'
    for url in "${store_urls[@]}"; do
        echo "$url"
    done
    echo EOF
} >> "$GITHUB_OUTPUT"

exit $exit_code
