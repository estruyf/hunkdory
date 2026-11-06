cask "hunkdory" do
  version "0.1.0"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/estruyf/hunkdory/releases/download/v#{version}/Hunkdory-#{version}-arm64-mac.zip"
  name "Hunkdory"
  desc "Tells a branch or pull request as a story, so you can review it"
  homepage "https://github.com/estruyf/hunkdory"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Hunkdory updates itself from the release feed, so `brew upgrade` leaves it alone rather than
  # race the in-app updater. The tap still moves on every release, which is what `--greedy` and a
  # fresh `brew install` read.
  # Only an Apple Silicon build is released, and LSMinimumSystemVersion is Electron's floor.
  # The in-app updater has no floor of its own, so `macos` has to move whenever Electron's does.
  auto_updates true
  depends_on arch: :arm64
  depends_on macos: :ventura

  app "Hunkdory.app"

  # An upgrade would otherwise replace the bundle under a copy that is still running.
  uninstall quit: "dev.hunkdory.app"

  # Hunkdory's own files only. Sessions belong to the agents that wrote them, and repos to you, so
  # `brew uninstall --zap` never touches those.
  zap trash: [
    "~/Library/Application Support/Hunkdory",
    "~/Library/Caches/dev.hunkdory.app",
    "~/Library/Caches/dev.hunkdory.app.ShipIt",
    "~/Library/Caches/hunkdory-updater",
    "~/Library/HTTPStorages/dev.hunkdory.app",
    "~/Library/Preferences/dev.hunkdory.app.plist",
    "~/Library/Saved Application State/dev.hunkdory.app.savedState",
  ]
end
