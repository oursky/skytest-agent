class Skytest < Formula
  desc "SkyTest runner management CLI"
  homepage "https://github.com/oursky/skytest-agent"
  version "__VERSION__"
  license "MIT"

  on_macos do
    on_arm do
      url "__ARCHIVE_URL_ARM64__"
      sha256 "__ARCHIVE_SHA256_ARM64__"
    end

    on_intel do
      url "__ARCHIVE_URL_AMD64__"
      sha256 "__ARCHIVE_SHA256_AMD64__"
    end
  end

  depends_on "node"

  def install
    libexec.install Dir["*"]
    ENV["PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD"] = "1"
    ENV["PRISMA_SKIP_POSTINSTALL_GENERATE"] = "1"
    system "npm", "ci", "--prefix", libexec

    state_dir = var/"skytest"
    state_dir.mkpath

    (bin/"skytest").write <<~EOS
      #!/usr/bin/env bash
      set -euo pipefail
      export SKYTEST_STATE_DIR="#{state_dir}"
      export SKYTEST_CLI_VERSION="#{version}"
      exec node --import "#{libexec}/node_modules/tsx/dist/loader.mjs" "#{libexec}/apps/cli/src/index.ts" "$@"
    EOS

    chmod 0755, bin/"skytest"
  end

  test do
    output = shell_output("#{bin}/skytest version")
    assert_match(version.to_s, output)
  end
end
