module.exports = async ({ github, context, core, custom_paths }) => {
  try {
    const owner = context.repo.owner;
    const repo = context.repo.repo;
    const pullRequest = context.payload.pull_request;
    if (pullRequest == undefined) {
      core.setFailed(`Cannot find Pull Request`);
    }
    const labelNames = pullRequest.labels.map((l) => l.name);
    console.log(`PR labels: ${labelNames}`);
    const skipChangeLogLabel = "skip-changelog";
    if (labelNames.includes(skipChangeLogLabel)) {
      console.log(
        `Skipping changelog checks: found "${skipChangeLogLabel}" label on PR`
      );
      return;
    }

    let files = [];
    for await (const response of github.paginate.iterator(
      github.rest.pulls.listFiles,
      {
        owner: owner,
        repo: repo,
        pull_number: pullRequest.number,
      }
    )) {
      files.push(...response.data);
    }
    console.log("Files changed in the PR: " + files.length);

    let extensions = new Set();
    let missingChangelogs = [];
    let caseMismatchChangelogs = [];
    files.forEach((file) => {
      const parts = file.filename.split("/");
      if (parts.length > 2 && parts[0] === "extensions") {
        extensions.add(parts[1]);
      }
    });
    console.log("Extensions changed:");
    extensions.forEach((extension) => {
      console.log(`- ${extension}`);
    });

    let changelogFileName = "CHANGELOG.md";
    extensions.forEach((extension) => {
      const changelogPath = `extensions/${extension}/${changelogFileName}`;
      const changelogExists = files.some(
        (file) => file.filename === changelogPath
      );
      if (!changelogExists) {
        const caseInsensitiveMatch = files.find(
          (file) => file.filename.toLowerCase() === changelogPath.toLowerCase()
        );
        if (caseInsensitiveMatch) {
          caseMismatchChangelogs.push(extension);
        } else {
          missingChangelogs.push(extension);
        }
      }
    });

    if (caseMismatchChangelogs.length > 0) {
      core.setFailed(
        `Changelog file found with the wrong case for extensions: ${caseMismatchChangelogs.join(
          ", "
        )}. Expected '${changelogFileName}'.`
      );
    } else if (missingChangelogs.length > 0) {
      core.setFailed(
        `Missing ${changelogFileName} update for extensions: ${missingChangelogs.join(
          ", "
        )}`
      );
    }
  } catch (error) {
    core.setFailed(error.message);
  }
};
