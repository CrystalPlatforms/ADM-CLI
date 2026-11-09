class Adm < Formula
  desc "ADM — lightweight, multi-platform developer environment installer"
  homepage "https://github.com/CrystalPlatforms/ADM-CLI"
  version "0.2.3"
  license "MIT"

  # Portable bundles: each ships ADM (app/) and a private Node runtime,
  # so no system Node dependency is needed.
  on_arm do
    url "https://github.com/CrystalPlatforms/ADM-CLI/releases/download/v#{version}/adm-v#{version}-darwin-arm64.tar.gz"
    sha256 "PENDING_UPLOAD_adm-v0.2.3-darwin-arm64"
  end
  on_intel do
    url "https://github.com/CrystalPlatforms/ADM-CLI/releases/download/v#{version}/adm-v#{version}-darwin-x64.tar.gz"
    sha256 "PENDING_UPLOAD_adm-v0.2.3-darwin-x64"
  end

  def install
    # Install the whole portable bundle (app + private Node runtime).
    libexec.install Dir["*"]
    # Wrapper that runs adm under the bundled private Node.
    (bin/"adm").write <<~EOS
      #!/bin/sh
      exec "#{libexec}/runtime/bin/node" "#{libexec}/app/bin/adm" "$@"
    EOS
  end

  def caveats
    <<~EOS
      ADM ships its own Node runtime — no system Node is required.
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/adm -v")
  end
end
