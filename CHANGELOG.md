# Changelog

All notable changes to Hunkdory are listed here. Each release is also on the [releases page](https://github.com/estruyf/hunkdory/releases), with the `.dmg` and `.zip` for a Mac and the installer for Windows.

## [Unreleased]

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
