# Changelog

All notable changes to Hunkdory are listed here. Each release is also on the [releases page](https://github.com/estruyf/hunkdory/releases), with the `.dmg` and `.zip` for a Mac and the installer for Windows.

## [Unreleased]

### Added

- **Open a review from a link.** `hunkdory://review?repo=<folder>&branch=<branch>` opens that branch's review, from a script, a runbook or another app, whether Hunkdory is running or not. A folder that isn't a project yet offers to add it. A link only opens the review: nothing runs until you say so. See [How it works](docs/how-it-works.md#links).
- **Open in Seshboard.** When a review's agent session is a Claude Code one and Seshboard is installed, one click opens that session in Seshboard.
- **Ask or change from a line.** What you write on a line of the diff can go to your assistant as a question or a change request, instead of only staying as a comment. An AI review finding under its line now has the same actions as the one at the top of the step: ask about it, have it fixed, add it as a comment, or set it aside.
- **Hide the shortcut hints.** Settings, Appearance can turn off the keys shown next to buttons and in footers. The shortcuts keep working, and <kbd>?</kbd> still lists them all.
- **About this change.** Start now opens a few short pages before the steps: what reviewers said on the PR, what was asked and what the change did, how it fits together, and what behaves differently. Each page only shows when there's something on it. They stay in the Context panel on every step, and <kbd>U</kbd> opens them again.

### Changed

- **A shorter plan.** The plan is now a cover: what the change is, the button to start, and one line each for GitHub, the walkthrough, the AI review, the agent's tests and anything else to know first. The decision and step lists moved into the review's progress bar, and the AI review's findings show on their steps.

## [0.2.0] - 2026-11-09

Hunkdory comes to Windows.

### Added

- **Windows.** Hunkdory runs on Windows 10 and 11, on x64 and Arm, with a signed installer that keeps itself up to date like the Mac app. Claude Code and the Copilot CLI both work there.

## [0.1.0] - 2026-11-06

The first release: a Mac app that tells a branch or pull request as a story, so you can review code you didn't write.

### Added

- **One inbox.** Local branches, open pull requests (Copilot's too) and uncommitted changes show up on their own, across all your projects.
- **A story to follow.** A change is split into steps in reading order, each saying why it's there, what behaves differently and what could break, right above the code it's about.
- **Ask about anything.** Your assistant answers questions about any step from the code, and from the agent's own session when there is one. Ask it to change something and it does that too.
- **Decide when you're done.** Merge, open or review a pull request, send the work back to the agent with your comments, or close the review. If the branch changed since you last looked, Hunkdory shows you what's new first.
- **Nothing hidden.** Every changed line is in some step, and work nobody asked for is called out.
- **AI review.** Run a review of a branch when you want one, and act on each finding.
- **Your assistant, your choice.** Claude Code or the Copilot CLI, and other agents through the Agent Client Protocol (experimental). Set a project to Manual and its code never leaves your Mac.
- **Updates from inside the app.** When there's a new version, a toast offers it, downloads it when you say so, and restarts when you're ready. **Settings › About** shows the status and can check by hand.
- **Homebrew.** `brew install --cask estruyf/tap/hunkdory`.

[Unreleased]: https://github.com/estruyf/hunkdory/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/estruyf/hunkdory/releases/tag/v0.2.0
[0.1.0]: https://github.com/estruyf/hunkdory/releases/tag/v0.1.0
