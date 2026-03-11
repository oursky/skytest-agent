class Skytest < Formula
  desc "SkyTest CLI runner manager"
  homepage "https://github.com/oursky/skytest-agent"
  url "__ARCHIVE_URL__"
  sha256 "__ARCHIVE_SHA256__"
  version "__VERSION__"
  license "MIT"

  depends_on "node"

  def install
    libexec.install Dir["*"]
    system "npm", "install", "--prefix", libexec, "tsx@4.20.6"
    state_dir = var/"skytest"
    state_dir.mkpath
    (bin/"skytest").write <<~EOS
      #!/usr/bin/env bash
      set -euo pipefail
      export SKYTEST_STATE_DIR="#{state_dir}"
      exec node --import "#{libexec}/node_modules/tsx/dist/loader.mjs" "#{libexec}/apps/cli/src/index.ts" "$@"
    EOS
    chmod 0755, bin/"skytest"
  end

  test do
    output = shell_output("#{bin}/skytest --help")
    assert_match("SkyTest CLI", output)
  end
end
