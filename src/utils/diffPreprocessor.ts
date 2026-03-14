/**
 * Preprocesses raw git diffs before sending to LLM.
 * Strips noise tokens that carry no semantic value for summarization.
 * Typical reduction: 30-50% fewer tokens on real-world diffs.
 */

// Files that are pure noise — no value in summarizing these
const SKIP_FILE_PATTERNS = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /composer\.lock$/,
  /Gemfile\.lock$/,
  /Cargo\.lock$/,
  /poetry\.lock$/,
  /\.min\.(js|css)$/,
  /dist\/.*\.(js|css|map)$/,
  /build\/.*\.(js|css|map)$/,
  /\.map$/,
  /\.snap$/,          // jest snapshots — huge, low signal
];

export interface PreprocessResult {
  diff: string;
  skippedFiles: string[];
  originalBytes: number;
  processedBytes: number;
}

/**
 * Strip noise from a raw git diff and skip low-signal files.
 */
export function preprocessDiff(rawDiff: string): PreprocessResult {
  const originalBytes = Buffer.byteLength(rawDiff, 'utf8');
  const skippedFiles: string[] = [];

  // Split into per-file sections on diff --git headers
  const fileSections = rawDiff.split(/(?=^diff --git )/m).filter(Boolean);

  const keptSections: string[] = [];

  for (const section of fileSections) {
    // Extract the file path from the diff header
    const headerMatch = section.match(/^diff --git a\/(.*?) b\/(.*?)$/m);
    const filePath = headerMatch?.[2] ?? headerMatch?.[1] ?? '';

    // Skip noise files entirely
    if (SKIP_FILE_PATTERNS.some((p) => p.test(filePath))) {
      skippedFiles.push(filePath);
      continue;
    }

    keptSections.push(cleanSection(section));
  }

  const diff = keptSections.join('\n');
  const processedBytes = Buffer.byteLength(diff, 'utf8');

  return { diff, skippedFiles, originalBytes, processedBytes };
}

/**
 * Clean a single file section of a diff:
 * - Remove index lines (index abc123..def456 100644)
 * - Remove "\ No newline at end of file" markers
 * - Remove binary file notices
 * - Collapse runs of 3+ unchanged context lines down to 1
 *   (keeps the signal, drops the padding)
 */
function cleanSection(section: string): string {
  const lines = section.split('\n');
  const cleaned: string[] = [];
  let unchangedRun = 0;

  for (const line of lines) {
    // Drop index metadata lines
    if (/^index [0-9a-f]+\.\.[0-9a-f]+/.test(line)) continue;
    // Drop "no newline" markers
    if (line === '\\ No newline at end of file') continue;
    // Drop binary file notices
    if (/^Binary files/.test(line)) {
      cleaned.push('[binary file changed]');
      continue;
    }

    // Collapse long runs of unchanged context lines
    if (line.startsWith(' ')) {
      unchangedRun++;
      // Keep first and last of a run, collapse the middle
      if (unchangedRun === 1) {
        cleaned.push(line);
      } else if (unchangedRun === 2) {
        cleaned.push(line);
      } else {
        // Replace middle of run with a single ellipsis marker (once)
        if (unchangedRun === 3) cleaned.push('  ...');
        // skip subsequent unchanged lines
      }
    } else {
      unchangedRun = 0;
      cleaned.push(line);
    }
  }

  return cleaned.join('\n');
}

/**
 * Returns true if a commit is trivially small and can skip LLM analysis.
 * Criteria: tiny line count AND only touches known low-signal file types.
 */
export function isTrivialCommit(
  rawDiff: string,
  additions: number,
  deletions: number
): boolean {
  const totalLines = additions + deletions;
  if (totalLines > 20) return false;

  // Only trivial if all changed files are docs/config/formatting
  const TRIVIAL_PATTERNS = [
    /\.md$/i,
    /\.txt$/i,
    /\.rst$/i,
    /\.gitignore$/,
    /\.editorconfig$/,
    /\.prettierrc/,
    /\.eslintrc/,
    /CHANGELOG/i,
    /LICENSE/i,
    /README/i,
  ];

  const fileMatches = [...rawDiff.matchAll(/^diff --git a\/(.*?) b\//gm)];
  if (fileMatches.length === 0) return false;

  return fileMatches.every(([, path]) =>
    TRIVIAL_PATTERNS.some((p) => p.test(path ?? ''))
  );
}
