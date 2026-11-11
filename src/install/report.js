// Per-tool result rendering shared by the ADM_TOOLS runner (#29) and the
// wizard's final report (#30). Plain text, no colors — readable in logs/CI.

const STATUS_MARKS = { installed: '✓', skipped: '✓', failed: '✗', reinstalled: '✓', manual: 'i' };

const STATUS_LABELS = {
  installed: 'installed',
  reinstalled: 'reinstalled',
  skipped: 'skipped',
  failed: 'failed',
  manual: 'manual',
};

// Renders the final report lines for a list of results
// (as produced by executeInstall).
function renderResults(results, { summary = true } = {}) {
  const lines = [];
  for (const r of results) {
    const mark = STATUS_MARKS[r.status] || ' ';
    const label = STATUS_LABELS[r.status] || r.status;
    lines.push(`${mark} ${r.name || r.id} — ${label}`);
    if (r.status === 'skipped' && r.reason) lines.push(`    ${r.reason}${r.url ? `: ${r.url}` : ''}`);
    if (r.status === 'manual' && (r.hint || r.reason)) lines.push(`    ${r.hint || r.reason}`);
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
    const reinstalled = results.filter(r => r.status === 'reinstalled').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const manual = results.filter(r => r.status === 'manual').length;
    const failed = results.filter(r => r.status === 'failed').length;
    lines.push('');
    lines.push(`Done: ${installed} installed${reinstalled ? `, ${reinstalled} reinstalled` : ''}, ${skipped} skipped${manual ? `, ${manual} manual` : ''}, ${failed} failed.`);
  }
  return lines.join('\n');
}

module.exports = { renderResults, STATUS_MARKS };
