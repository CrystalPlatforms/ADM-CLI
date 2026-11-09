// Per-tool result rendering shared by the ADM_TOOLS runner (#29) and the
// wizard's final report (#30). Plain text, no colors — readable in logs/CI.

const STATUS_MARKS = { installed: '✓', skipped: '✓', failed: '✗' };

// Renders the final report lines for a list of results
// (as produced by executeInstall).
function renderResults(results, { summary = true } = {}) {
  const lines = [];
  for (const r of results) {
    const mark = STATUS_MARKS[r.status] || ' ';
    lines.push(`${mark} ${r.name || r.id} — ${r.status === 'installed' ? 'installed' : r.status === 'skipped' ? 'skipped' : 'failed'}`);
    if (r.status === 'skipped' && r.reason) lines.push(`    ${r.reason}${r.url ? `: ${r.url}` : ''}`);
    if (r.note) lines.push(`    ${r.note}`);
    if (r.status === 'failed') {
      lines.push(`    command: ${r.command || '(none)'}`);
      if (r.error) lines.push(`    error: ${String(r.error).trim()}`);
      if (r.hint) {
        lines.push('    hint:');
        for (const hl of String(r.hint).split('\n')) lines.push(`      ${hl}`);
      }
    }
  }
  if (summary) {
    const installed = results.filter(r => r.status === 'installed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const failed = results.filter(r => r.status === 'failed').length;
    lines.push('');
    lines.push(`Done: ${installed} installed, ${skipped} skipped, ${failed} failed.`);
  }
  return lines.join('\n');
}

module.exports = { renderResults, STATUS_MARKS };
