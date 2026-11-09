// Parses /etc/os-release content into { id, version, idLike }.
// Handles the common formats: KEY=value with optional quotes,
// comments, blank lines.
function parseOsRelease(content) {
  if (!content) return { id: null, version: null, idLike: [] };
  const fields = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  return {
    id: (fields.ID || '').toLowerCase() || null,
    version: fields.VERSION_ID || null,
    idLike: (fields.ID_LIKE || '').toLowerCase().split(/\s+/).filter(Boolean),
  };
}

module.exports = { parseOsRelease };
