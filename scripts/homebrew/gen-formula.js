#!/usr/bin/env node
// Generates the Homebrew formula for the portable release bundles (#31).
//
//   node scripts/homebrew/gen-formula.js [--dist dist] [--out scripts/homebrew/adm.rb]
//
// Reads dist/adm-v<version>-darwin-{arm64,x64}.tar.gz.sha256 (produced by
// build-bundle.js) and fills them into the formula template. When the sha256
// files are absent, the formula is generated with PENDING placeholders —
// replace them at release time (manual tap publishing is out of scope for
// CI; the owner pushes the tap).

const fs = require('fs');
const path = require('path');

function main() {
  const args = process.argv.slice(2);
  const get = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const dist = path.resolve(get('dist', 'dist'));
  const out = path.resolve(get('out', path.join(__dirname, 'adm.rb')));

  const { version } = require(path.resolve(__dirname, '..', '..', 'package.json'));

  const sha = arch => {
    const file = path.join(dist, `adm-v${version}-darwin-${arch}.tar.gz.sha256`);
    try {
      return fs.readFileSync(file, 'utf8').trim().split(/\s+/)[0];
    } catch {
      return `PENDING_UPLOAD_adm-v${version}-darwin-${arch}`;
    }
  };

  const formula = `class Adm < Formula
  desc "ADM — lightweight, multi-platform developer environment installer"
  homepage "https://github.com/CrystalPlatforms/ADM-CLI"
  version "${version}"
  license "MIT"

  # Portable bundles: each ships ADM (app/) and a private Node runtime,
  # so no system Node dependency is needed.
  on_arm do
    url "https://github.com/CrystalPlatforms/ADM-CLI/releases/download/v#{version}/adm-v#{version}-darwin-arm64.tar.gz"
    sha256 "${sha('arm64')}"
  end
  on_intel do
    url "https://github.com/CrystalPlatforms/ADM-CLI/releases/download/v#{version}/adm-v#{version}-darwin-x64.tar.gz"
    sha256 "${sha('x64')}"
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
`;

  fs.writeFileSync(out, formula, 'utf8');
  console.log(`formula written: ${out}`);
}

main();
