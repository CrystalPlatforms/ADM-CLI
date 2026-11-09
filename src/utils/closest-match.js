// Levenshtein edit distance, small strings only.
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

// Returns candidates within a small edit distance, closest first.
function closestMatches(input, candidates, maxDistance = 2, limit = 3) {
  const scored = [];
  for (const candidate of candidates) {
    const d = editDistance(input.toLowerCase(), candidate.toLowerCase());
    if (d > 0 && d <= maxDistance) scored.push({ candidate, d });
    if (candidate.toLowerCase().startsWith(input.toLowerCase()) && d > maxDistance) {
      scored.push({ candidate, d });
    }
  }
  scored.sort((x, y) => x.d - y.d);
  return scored.slice(0, limit).map(s => s.candidate);
}

module.exports = { editDistance, closestMatches };
