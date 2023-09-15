module.exports = async ({ github, context, core, custom_paths }) => {
    const commitSHA = context.sha;
    const owner = context.repo.owner;
    const repo = context.repo.repo;

    console.log("Custom paths: " + custom_paths);
    let directories = new Set();
    if (context.eventName === 'workflow_dispatch') {
        custom_paths.split(',').forEach(dir => directories.add(dir));
    } else {
        let pull_number;
        if (context.payload.pull_request) {
            pull_number = context.payload.pull_request.number;
        } else {
            try {
                await github.rest.repos.listPullRequestsAssociatedWithCommit({
                    owner: owner,
                    repo: repo,
                    commit_sha: commitSHA,
                })
                .then(async function(response) {
                    if (response.data.length > 0) {
                        const pr = response.data[0];
                        pull_number = pr.number;
                    }
                });
            } catch (error) {
                if (error.status === 403) {
                    // when running from private organization repository without a proper token, we may not be able to use the GitHub API
                    // in that case we fallback to full checkout
                    console.log("Received a 403 error. Permission denied to access the resource.");
                } else {
                    core.setFailed(`Action failed with error: ${error.message}`);
                }
            }
        }

        if (pull_number) {
            console.log("Pull request number: " + pull_number)
            const response = await github.rest.pulls.listFiles({
                owner: owner,
                repo: repo,
                pull_number: pull_number
            });
            const files = response.data;
            console.log('Files changed in the PR: ' + files.length);
            files.forEach(file => {
                const parts = file.filename.split('/');
                if (parts.length > 2 && parts[0] === 'extensions') {
                    directories.add('extensions/' + parts[1] + '/');
                }
            });
        } else {
            console.log("No PR found for commit " + context.sha);
            return
        }
    }

    if (directories.size > 0) {
        sparse_directories = Array.from(directories).map(path =>
            // use /* for sparse checkout arguments instead of /** for the wildcard pattern
            path.endsWith('/**') ? path.replace('/**', '') : path
        );
        // using environment variable for sparse-checkout due to problems with new lines in setOutput
        core.exportVariable('sparse_checkout_directories', Array.from(sparse_directories).join('\n'));
        core.setOutput('changed_files', Array.from(directories).join(','));
    }
}
