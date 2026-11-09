const { parseOsRelease } = require('../../../src/platform/os-release');

const FIXTURES = {
  ubuntu: `NAME="Ubuntu"\nVERSION="22.04.3 LTS (Jammy Jellyfish)"\nID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 22.04.3 LTS"\nVERSION_ID="22.04"\nHOME_URL="https://www.ubuntu.com/"\n`,
  fedora: `NAME="Fedora Linux"\nVERSION="39 (Server Edition)"\nID=fedora\nVERSION_ID=39\nPRETTY_NAME="Fedora Linux 39 (Server Edition)"\n`,
  arch: `NAME="Arch Linux"\nPRETTY_NAME="Arch Linux"\nID=arch\nBUILD_ID=rolling\nANSI_COLOR="38;2;23;147;209"\n`,
  opensuse: `NAME="openSUSE Leap"\nVERSION="15.5"\nID="opensuse-leap"\nID_LIKE="suse opensuse"\nVERSION_ID="15.5"\nPRETTY_NAME="openSUSE Leap 15.5"\n`,
  alpine: `NAME="Alpine Linux"\nID=alpine\nVERSION_ID=3.19.1\nPRETTY_NAME="Alpine Linux v3.19"\n`,
};

describe('parseOsRelease — distro fixtures', () => {
  test('parses each fixture: id, version, idLike', () => {
    expect(parseOsRelease(FIXTURES.ubuntu)).toEqual({
      id: 'ubuntu', version: '22.04', idLike: ['debian'],
    });
    expect(parseOsRelease(FIXTURES.fedora)).toEqual({
      id: 'fedora', version: '39', idLike: [],
    });
    expect(parseOsRelease(FIXTURES.arch)).toEqual({
      id: 'arch', version: null, idLike: [],
    });
    expect(parseOsRelease(FIXTURES.opensuse)).toEqual({
      id: 'opensuse-leap', version: '15.5', idLike: ['suse', 'opensuse'],
    });
    expect(parseOsRelease(FIXTURES.alpine)).toEqual({
      id: 'alpine', version: '3.19.1', idLike: [],
    });
  });

  test('handles empty content', () => {
    expect(parseOsRelease('')).toEqual({ id: null, version: null, idLike: [] });
  });
});
