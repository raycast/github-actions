# Extension Duplicate Check

A GitHub Action for [raycast/extensions](https://github.com/raycast/extensions) that flags new extensions that look
like duplicates of extensions in the Raycast Store or of extensions added by other open pull requests.

For every `extensions/<name>/package.json` a pull request adds, the action:

1. Reads the manifest: name, title, description, commands, tools, keywords and categories.
2. Loads the store catalog from Redash query [3594](https://redash.raycast.com/queries/3594) and the extensions added by
   every other open pull request in the repository.
3. Scores how similar the new extension is to each of them, either in process (`lexical`) or by asking TypeSafe's
   [Jev](https://docs.typesafe.ai) model to judge the closest matches (`jev`).
4. Comments on the pull request with the top matches when one looks like a duplicate, keeps an earlier comment up to
   date, optionally labels the pull request, and sets the `has-duplicates` and `matches` outputs. The full report always
   goes to the job summary.

Pull requests that only change existing extensions are ignored.

## Usage

Add `.github/workflows/duplicate-extension-check.yml` to raycast/extensions. [Integrating with
raycast/extensions](#integrating-with-raycastextensions) lists the secrets and the other changes it needs.

```yaml
name: Duplicate Extension Check

on:
  pull_request_target:
    types: [opened, synchronize, reopened]
    paths:
      - "extensions/*/package.json"

permissions: {}

concurrency:
  group: duplicate-extension-check-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  check:
    if: github.repository == 'raycast/extensions'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
      issues: write
      pull-requests: write
    steps:
      - uses: raycast/github-actions/extension-duplicate-check@<commit-sha>
        with:
          github-token: ${{ secrets.RAYCAST_BOT_API_ACCESS_TOKEN }}
          redash-api-key: ${{ secrets.REDASH_API_KEY }}
          scorer: jev
          typesafe-api-key: ${{ secrets.TYPESAFE_API_KEY }}
          label: possible-duplicate
```

`pull_request_target` is needed so that pull requests from forks can be commented on and the secret is available. The
action never checks out or runs code from the pull request: it only reads `package.json` files as data through the
GitHub API. Keep it that way in the calling workflow too: do not add an `actions/checkout` of the pull request head or
any step that runs pull request code in this job, since it has the bot token, the Redash key and the TypeSafe key.

Pin the action to a full commit SHA rather than a tag, so a moved tag cannot change the code that receives the secret.
raycast/extensions doesn't run Dependabot, so bump the SHA by hand after changing this action.

## Inputs

| Input                      | Default                      | Description                                                                                                                                                                                              |
| -------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github-token`             | `${{ github.token }}`        | Token used to read pull requests, comment and label. Needs `pull-requests: write` and `issues: write`.                                                                                                   |
| `redash-api-key`           |                              | Redash API key for the store catalog. Pass it from a secret. Without it, the store is not checked and the comment says so.                                                                               |
| `redash-url`               | `https://redash.raycast.com` | Base URL of the Redash instance.                                                                                                                                                                         |
| `redash-query-id`          | `3594`                       | Redash query that returns the store catalog.                                                                                                                                                             |
| `scorer`                   | `lexical`                    | `lexical` scores in process. `jev` shortlists with `lexical` and asks TypeSafe's Jev model to judge each match.                                                                                          |
| `typesafe-api-key`         |                              | TypeSafe API key, required by the `jev` scorer. Pass it from a secret.                                                                                                                                   |
| `typesafe-model`           | `jev-1.14.0`                 | TypeSafe model name or alias for the `jev` scorer. Pinned because thresholds are tuned per version and `jev-latest` can move.                                                                            |
| `threshold`                | `0.5`                        | Score (0–1) at or above which a match counts as a possible duplicate.                                                                                                                                    |
| `min-score`                | `0.2`                        | Matches below this score are left out of the comment and the `matches` output.                                                                                                                           |
| `top-n`                    | `5`                          | Number of matches listed per source (store and open pull requests) for each new extension.                                                                                                               |
| `label`                    |                              | Label added when a possible duplicate is found and removed otherwise. Empty disables labeling.                                                                                                           |
| `check-open-pull-requests` | `true`                       | Whether to compare against extensions added by other open pull requests.                                                                                                                                 |
| `comment`                  | `true`                       | Whether to comment on the pull request. A comment is created only when a possible duplicate is found, and an existing one is updated on every run. The full report is always written to the job summary. |
| `pull-request-number`      |                              | Pull request to check, for `workflow_dispatch` runs. Defaults to the pull request of the triggering event.                                                                                               |

## Outputs

| Output           | Description                                                            |
| ---------------- | ---------------------------------------------------------------------- |
| `has-duplicates` | `true` if any match scored at or above `threshold`, otherwise `false`. |
| `matches`        | JSON array with one entry per new extension, see below.                |

```json
[
  {
    "name": "pomodoro-windows",
    "title": "Pomodoro for Windows",
    "path": "extensions/pomodoro-windows/package.json",
    "store": [
      {
        "name": "pomodoro",
        "title": "Pomodoro",
        "author": "asubbotin",
        "url": "https://www.raycast.com/asubbotin/pomodoro",
        "score": 0.575,
        "signals": { "content": 0.421, "name": 0.907 }
      }
    ],
    "pullRequests": [
      {
        "name": "pomodoro-md",
        "title": "Pomodoro.md",
        "author": "yukitomo26",
        "url": "https://github.com/raycast/extensions/pull/30778",
        "pullRequest": 30778,
        "score": 0.57,
        "signals": { "content": 0.426, "name": 0.9 }
      }
    ]
  }
]
```

## Scoring

The `lexical` scorer combines two signals:

- **Content**: the cosine similarity of TF-IDF vectors built from the title (weight 3), description (2), command titles
  and descriptions (1.5), keywords (1.5), tools (1) and categories (0.5). Text is lowercased, stripped of diacritics,
  split on camelCase and punctuation, cleaned of stop words and Raycast boilerplate, and lightly stemmed.
- **Name**: the best Jaro-Winkler similarity between the names and titles, ignoring case and punctuation. Values below
  0.8 count as unrelated.

The score is `1 - (1 - content) × (1 - 0.5 × name)`, so either signal alone can raise it and identical names alone reach
0.5. The default threshold of 0.5 comes from a backtest over three months of new-extension pull requests: it flagged
37% of those closed as duplicates of a store extension and 11% of those that were merged.

The lexical scorer misses duplicates that describe the same thing in different words. In the same backtest it ranked
the extension a reviewer named as the duplicate first for 14 of 31 rejected pull requests, and in its top 10 for 28 of
them, but often with scores between 0.2 and 0.4. The `jev` scorer is built on that gap.

### Jev

[Jev](https://docs.typesafe.ai) is TypeSafe's structured-decision model. It doesn't write text. It answers typed
questions with calibrated probabilities, which suits a yes/no judgement made thousands of times a month.

For each new extension, the `jev` scorer:

1. Takes the 10 best `lexical` matches across the store and open pull requests.
2. Sends one request to `POST https://api.typesafe.ai/v1/systemone`. The state holds the title, description, commands,
   tools and keywords of the new extension and of each match. Each match gets three questions:
   - **covers** (yes/no): can the existing extension already do the new extension's main task?
   - **services** (yes/no): are the two built for different specific apps or services, like a Proton Mail client and a
     Spark Mail client?
   - **relation** (choice): `different`, `partial` overlap, the same purpose with the new extension adding features
     (`enhancement`), or the `same` purpose and features.
3. Scores each match as `covers × (1 - services)`. The relation only words the comment.

Asking Jev directly whether two extensions have the same main purpose flagged 56% of merged extensions, because most
extensions in a crowded category share a purpose. Splitting the judgement into narrow questions fixed that. The backtest
over the same three months, with `jev-1.14.0`:

| Scorer    | Threshold | Merged extensions flagged | Rejected duplicates caught |
| --------- | --------- | ------------------------: | -------------------------: |
| `lexical` | 0.5       |                       11% |                   15 of 41 |
| `jev`     | 0.5       |                        8% |                   24 of 41 |
| `jev`     | 0.45      |                       10% |                   27 of 41 |

Most of the merged extensions it flags overlap a lot with an existing one, such as WHost and iHosts, or Ghq Plus and
ghq, so they are worth a reviewer's look anyway. Of the 17 duplicates it misses at 0.5, 12 score below 0.4.

The relation also words the comment. `same` becomes "covers the same core functionality" and `enhancement` asks the
author to contribute the new features to the existing extension, as reviewers do by hand. Retries cover network
errors, `429`, `529` and server errors. If TypeSafe still fails, the action falls back to `lexical` and adds a warning
to the workflow run. The comment and job summary never name the scorer or other backends.

A request is about 5,000 input tokens. At $0.042 per million input tokens, with output free, roughly 800 runs a month
cost about $0.20. The 394-pull-request backtest took 25 seconds.

Manifests are written by pull request authors and Jev reads them as data, so a manifest can try to argue that it isn't
a duplicate. The lexical shortlist bounds what Jev sees, and a reviewer makes the final call.

Scorers implement the `Scorer` interface in [`src/scorers/scorer.ts`](src/scorers/scorer.ts) and are registered in
[`src/scorers/index.ts`](src/scorers/index.ts).

## Integrating with raycast/extensions

Most of this needs a raycast/extensions admin. Steps 1 to 3 can land in one pull request.

1. **Secrets.** Add these repository secrets:

   | Secret                         | Status                                                         | Used for                           |
   | ------------------------------ | -------------------------------------------------------------- | ---------------------------------- |
   | `RAYCAST_BOT_API_ACCESS_TOKEN` | Already exists. PR Bot, Stale and the label workflows use it.  | Comments and labels as @raycastbot |
   | `REDASH_API_KEY`               | New. A Redash API key that can read query 3594.                | The store catalog                  |
   | `TYPESAFE_API_KEY`             | New. From the [TypeSafe console](https://console.typesafe.ai). | The `jev` scorer                   |

2. **PR Bot.** `scripts/bots/pr-bot.ts` updates the first @raycastbot comment on a pull request. Both workflows run
   when a pull request opens, so if this action comments first, PR Bot replaces the duplicate comment with its
   "Congratulations on your new Raycast extension!" message. Make it skip this action's comment:

   ```ts
   const botComment = comments.find(
     (comment) =>
       comment.user?.login === "raycastbot" &&
       !comment.body?.includes("<!-- extension-duplicate-check -->"),
   );
   ```

3. **Workflow.** Add the workflow from [Usage](#usage), pinned to a commit SHA of this repository.

4. **Label.** If you set `label`, create `possible-duplicate` in raycast/extensions first, so it gets a colour and a
   description instead of the defaults GitHub uses for labels created on the fly.

5. **Roll out quietly first.** Run with `comment: false` and without `label` for a week or two. Each run still writes
   the full report to its job summary, so reviewers can compare it with their own calls before authors see anything.
   Then turn both back on.

Things to know about running as @raycastbot:

- The bot token is a personal access token, so the comment triggers other workflows, unlike comments made with the
  default `GITHUB_TOKEN`. Unstale already ignores events from @raycastbot.
- Its API calls count against @raycastbot's 5,000 requests an hour, which it shares with PR Bot and Stale. A run makes
  about 5 REST calls and 15 GraphQL points, so even busy days stay far below the limit.
- Use `github-token: ${{ github.token }}` instead if comments should come from `github-actions[bot]`. Then the PR Bot
  change isn't needed.

## Store catalog

The action reads the cached result of the Redash query from `GET /api/queries/3594/results.json` with an
`Authorization: Key <redash-api-key>` header. Column names are matched loosely, so the query can return for example
`name` or `slug`, `author`, `owner_handle` or an author JSON object, and `commands`, `keywords` and `categories` as JSON
arrays, Postgres arrays or comma-separated text. Rows with one command each are merged per extension. Store links come
from a `url` or `store_url` column, or are built as `https://www.raycast.com/<author>/<name>`.

## Development

```sh
npm install
npm test          # unit tests
npm run typecheck
npm run build     # bundles src into dist/index.js
```

Run these from this folder. `dist/index.js` is committed because GitHub runs it directly. Run `npm run build` and commit
the result after changing `src`. CI fails if `dist` is out of date.
