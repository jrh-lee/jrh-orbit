import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { save, open } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '../../stores/useAppStore';
import { FOLDERS } from '../../lib/constants';
import { splitFrontmatter, parseFrontmatterFields } from '../../lib/frontmatter';
import { importNotionExport, type ImportResult } from '../../lib/notionImporter';

type ExportStatus = 'idle' | 'exporting' | 'done' | 'error';
type ImportStatus = 'idle' | 'scanning' | 'confirming' | 'importing' | 'done' | 'error';

export function ImportExportSection() {
  const { dataDir } = useAppStore();

  // Import state
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [scannedFiles, setScannedFiles] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState(0);

  // Export state
  const [htmlExportStatus, setHtmlExportStatus] = useState<ExportStatus>('idle');
  const [mdExportStatus, setMdExportStatus] = useState<ExportStatus>('idle');
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  // ── Import from Notion ──

  const handleSelectNotionFolder = useCallback(async () => {
    setImportStatus('scanning');
    setImportResult(null);
    setImportError(null);
    setImportProgress(0);

    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) {
        setImportStatus('idle');
        return;
      }

      // Scan for .md files in the selected folder
      const files = await invoke<string[]>('list_notes', { dir: selected });
      const mdFiles = files.filter(f => f.endsWith('.md'));

      if (mdFiles.length === 0) {
        setImportError('No .md files found in the selected folder.');
        setImportStatus('error');
        return;
      }

      setScannedFiles(mdFiles);
      setImportStatus('confirming');
    } catch (e) {
      setImportError(`Failed to scan folder: ${String(e)}`);
      setImportStatus('error');
    }
  }, []);

  const handleConfirmImport = useCallback(async () => {
    if (!dataDir || scannedFiles.length === 0) return;

    setImportStatus('importing');
    setImportProgress(0);

    try {
      // We simulate progress by batching (the actual importer processes all at once)
      // For a real progress bar, we'd need to call import one-by-one
      const batchSize = Math.max(1, Math.floor(scannedFiles.length / 10));
      let totalImported = 0;
      const allErrors: string[] = [];

      for (let i = 0; i < scannedFiles.length; i += batchSize) {
        const batch = scannedFiles.slice(i, i + batchSize);
        const result = await importNotionExport(dataDir, batch);
        totalImported += result.imported;
        allErrors.push(...result.errors);
        setImportProgress(Math.min(100, Math.round(((i + batch.length) / scannedFiles.length) * 100)));
      }

      setImportResult({ imported: totalImported, errors: allErrors });
      setImportStatus('done');
      // Notify that notes changed
      window.dispatchEvent(new CustomEvent('notes-changed'));
    } catch (e) {
      setImportError(`Import failed: ${String(e)}`);
      setImportStatus('error');
    }
  }, [dataDir, scannedFiles]);

  const handleCancelImport = useCallback(() => {
    setImportStatus('idle');
    setScannedFiles([]);
    setImportResult(null);
    setImportError(null);
  }, []);

  // ── Export All as HTML ──

  const handleExportHtml = useCallback(async () => {
    if (!dataDir) return;

    setHtmlExportStatus('exporting');
    setExportMessage(null);

    try {
      const dest = await save({
        filters: [{ name: 'HTML', extensions: ['html'] }],
        defaultPath: 'jrh-orbit-notes-export.html',
      });
      if (!dest) {
        setHtmlExportStatus('idle');
        return;
      }

      // Collect all notes
      const folders = [FOLDERS.daily, FOLDERS.research];
      const noteEntries: { title: string; type: string; date: string; body: string }[] = [];

      for (const folder of folders) {
        try {
          const dir = await join(dataDir, folder);
          const files = await invoke<string[]>('list_notes', { dir });

          for (const f of files) {
            if (!f.endsWith('.md')) continue;
            try {
              const raw = await invoke<string>('read_note', { path: f });
              const { frontmatter, body } = splitFrontmatter(raw);
              const fields = parseFrontmatterFields(frontmatter);
              noteEntries.push({
                title: fields.title ?? f.split(/[/\\]/).pop()?.replace('.md', '') ?? 'Untitled',
                type: fields.type ?? 'note',
                date: fields.date ?? fields.created?.slice(0, 10) ?? '',
                body,
              });
            } catch {}
          }
        } catch {}
      }

      noteEntries.sort((a, b) => b.date.localeCompare(a.date));

      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      const noteHtml = noteEntries
        .map(
          (n) => `
        <article class="note">
          <h2>${esc(n.title)}</h2>
          <div class="meta">${esc(n.type)} &mdash; ${esc(n.date)}</div>
          <div class="body"><pre>${esc(n.body)}</pre></div>
        </article>`,
        )
        .join('\n');

      const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>JRH-Orbit Notes Export</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1.5rem; color: #222; background: #fafafa; }
  h1 { font-size: 1.5rem; border-bottom: 2px solid #ddd; padding-bottom: 0.5rem; }
  .summary { color: #666; font-size: 0.85rem; margin-bottom: 2rem; }
  .note { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; }
  .note h2 { margin: 0 0 0.25rem; font-size: 1.1rem; }
  .meta { font-size: 0.8rem; color: #888; margin-bottom: 0.75rem; }
  .body pre { white-space: pre-wrap; word-wrap: break-word; font-family: inherit; font-size: 0.9rem; line-height: 1.6; margin: 0; }
  @media print { body { margin: 0; } .note { break-inside: avoid; } }
</style>
</head>
<body>
<h1>JRH-Orbit Notes Export</h1>
<p class="summary">Exported ${noteEntries.length} notes on ${new Date().toISOString().slice(0, 10)}</p>
${noteHtml}
</body>
</html>`;

      await invoke('write_note', { path: dest, content: html });
      setHtmlExportStatus('done');
      setExportMessage(`Exported ${noteEntries.length} notes to HTML.`);
      setTimeout(() => setHtmlExportStatus('idle'), 3000);
    } catch (e) {
      setHtmlExportStatus('error');
      setExportMessage(`Export failed: ${String(e)}`);
    }
  }, [dataDir]);

  // ── Export All as Markdown ──

  const handleExportMarkdown = useCallback(async () => {
    if (!dataDir) return;

    setMdExportStatus('exporting');
    setExportMessage(null);

    try {
      const dest = await open({ directory: true, multiple: false });
      if (!dest) {
        setMdExportStatus('idle');
        return;
      }

      const folders = [FOLDERS.daily, FOLDERS.research];
      let count = 0;

      for (const folder of folders) {
        try {
          const dir = await join(dataDir, folder);
          const files = await invoke<string[]>('list_notes', { dir });

          // Ensure subfolder in destination
          const subFolderName = folder.replace('notes/', '');
          const destSubDir = await join(dest, subFolderName);
          await invoke('ensure_dir', { path: destSubDir });

          for (const f of files) {
            if (!f.endsWith('.md')) continue;
            try {
              const raw = await invoke<string>('read_note', { path: f });
              const filename = f.split(/[/\\]/).pop() ?? `note-${count}.md`;
              const outPath = await join(destSubDir, filename);
              await invoke('write_note', { path: outPath, content: raw });
              count++;
            } catch {}
          }
        } catch {}
      }

      // Also export reviews
      const reviewFolders = [FOLDERS.reviewsWeekly, FOLDERS.reviewsMonthly, FOLDERS.reviewsQuarterly];
      for (const folder of reviewFolders) {
        try {
          const dir = await join(dataDir, folder);
          const files = await invoke<string[]>('list_notes', { dir });
          const subFolderName = folder.replace('/', '-');
          const destSubDir = await join(dest, subFolderName);
          await invoke('ensure_dir', { path: destSubDir });

          for (const f of files) {
            if (!f.endsWith('.md')) continue;
            try {
              const raw = await invoke<string>('read_note', { path: f });
              const filename = f.split(/[/\\]/).pop() ?? `review-${count}.md`;
              const outPath = await join(destSubDir, filename);
              await invoke('write_note', { path: outPath, content: raw });
              count++;
            } catch {}
          }
        } catch {}
      }

      setMdExportStatus('done');
      setExportMessage(`Exported ${count} files to folder.`);
      setTimeout(() => setMdExportStatus('idle'), 3000);
    } catch (e) {
      setMdExportStatus('error');
      setExportMessage(`Export failed: ${String(e)}`);
    }
  }, [dataDir]);

  return (
      <div>
      {/* ── Import from Notion ── */}
      <div className="mb-4">
        <h3 className="text-sm font-medium text-ink-2 mb-2">Import from Notion</h3>
        <p className="text-[11px] text-ink-3 mb-2">
          Select a Notion export folder containing .md files. Notes will be imported into research notes with auto-detected types.
        </p>

        {importStatus === 'idle' && (
          <button
            onClick={handleSelectNotionFolder}
            className="px-4 py-1.5 text-sm rounded-sm border border-border hover:bg-paper-soft transition-colors"
          >
            Select Notion Export Folder...
          </button>
        )}

        {importStatus === 'scanning' && (
          <span className="text-sm text-ink-3">Scanning folder...</span>
        )}

        {importStatus === 'confirming' && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-ink-2">
              Found <strong>{scannedFiles.length}</strong> markdown files.
            </span>
            <button
              onClick={handleConfirmImport}
              className="px-4 py-1.5 text-sm rounded-sm bg-chrome text-paper hover:opacity-90 transition-opacity"
            >
              Import All
            </button>
            <button
              onClick={handleCancelImport}
              className="px-3 py-1.5 text-sm rounded-sm text-ink-3 hover:bg-paper-soft transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {importStatus === 'importing' && (
          <div className="max-w-md">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm text-ink-2">Importing...</span>
              <span className="text-sm text-ink-3">{importProgress}%</span>
            </div>
            <div className="w-full h-2 bg-paper-soft rounded-full overflow-hidden border border-border">
              <div
                className="h-full bg-chrome transition-all duration-300 rounded-full"
                style={{ width: `${importProgress}%` }}
              />
            </div>
          </div>
        )}

        {importStatus === 'done' && importResult && (
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <span className="text-sm text-ink">
                Imported {importResult.imported} notes successfully.
              </span>
              <button
                onClick={handleCancelImport}
                className="px-3 py-1 text-xs rounded-sm text-ink-3 hover:bg-paper-soft transition-colors"
              >
                Done
              </button>
            </div>
            {importResult.errors.length > 0 && (
              <div className="text-[11px] text-red-500 max-h-20 overflow-y-auto">
                {importResult.errors.map((err, i) => (
                  <div key={i}>{err}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {importStatus === 'error' && importError && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-red-500">{importError}</span>
            <button
              onClick={handleCancelImport}
              className="px-3 py-1 text-xs rounded-sm text-ink-3 hover:bg-paper-soft transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* ── Export ── */}
      <div>
        <h3 className="text-sm font-medium text-ink-2 mb-2">Export Notes</h3>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportHtml}
            disabled={htmlExportStatus === 'exporting'}
            className="px-4 py-1.5 text-sm rounded-sm border border-border hover:bg-paper-soft transition-colors disabled:opacity-40"
          >
            {htmlExportStatus === 'exporting' ? 'Exporting...' : 'Export All as HTML'}
          </button>
          <button
            onClick={handleExportMarkdown}
            disabled={mdExportStatus === 'exporting'}
            className="px-4 py-1.5 text-sm rounded-sm border border-border hover:bg-paper-soft transition-colors disabled:opacity-40"
          >
            {mdExportStatus === 'exporting' ? 'Exporting...' : 'Export All as Markdown'}
          </button>
          {exportMessage && (
            <span className={`text-sm ${htmlExportStatus === 'error' || mdExportStatus === 'error' ? 'text-red-500' : 'text-ink-2'}`}>
              {exportMessage}
            </span>
          )}
        </div>
        <p className="text-[11px] text-ink-3 mt-2">
          HTML exports all notes into a single file. Markdown exports preserves folder structure (daily, research, reviews).
        </p>
      </div>
      </div>
  );
}
