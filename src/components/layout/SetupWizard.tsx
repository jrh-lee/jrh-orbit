import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '../../stores/useAppStore';
import { ensureDataDir, writeJsonIfMissing, initDataFiles } from '../../lib/fileSystem';
import { FILES } from '../../lib/constants';

export function SetupWizard() {
  const { setDataDir, setSetupComplete } = useAppStore();
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [step, setStep] = useState<'welcome' | 'folder' | 'creating'>('welcome');
  const [error, setError] = useState<string | null>(null);

  async function handleSelectFolder() {
    const dir = await open({ directory: true, title: 'Select data folder' });
    if (typeof dir === 'string') {
      setSelectedDir(dir);
    }
  }

  async function handleComplete() {
    if (!selectedDir) return;
    setStep('creating');
    setError(null);

    try {
      await ensureDataDir(selectedDir);

      // 기존 데이터 폴더를 선택하는 경우(기기 추가/재설치)가 흔하므로
      // 모든 초기 파일은 "없을 때만" 생성한다 — 무조건 쓰면 기존 데이터가
      // 통째로 날아간다 (2026-07-15 todos/projects/playlist 소실 사고).
      await writeJsonIfMissing(selectedDir, FILES.todos, {
        version: 1,
        lastModified: new Date().toISOString(),
        todos: [],
      });

      await writeJsonIfMissing(selectedDir, FILES.projects, {
        version: 1,
        projects: [],
      });

      await initDataFiles(selectedDir);

      await writeJsonIfMissing(selectedDir, FILES.ddays, { events: [] });
      await writeJsonIfMissing(selectedDir, FILES.playlist, { items: [], lastIndex: 0 });

      await writeJsonIfMissing(selectedDir, FILES.config, {
        theme: 'light',
        pomodoroWork: 25,
        pomodoroBreak: 5,
        pomodoroLongBreak: 15,
      });

      setDataDir(selectedDir);
      setSetupComplete(true);
    } catch (e) {
      setError(String(e));
      setStep('folder');
    }
  }

  if (step === 'welcome') {
    return (
      <div className="h-full flex items-center justify-center bg-paper">
        <div className="max-w-md text-center space-y-6 p-8">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-pastel-blue to-pastel-lavender flex items-center justify-center">
            <span className="text-2xl font-bold text-white">O</span>
          </div>
          <h1 className="text-3xl font-semibold text-ink">JRH-Orbit</h1>
          <p className="text-ink-2 leading-relaxed">
            Welcome! Let's set up your workspace.
            Choose a cloud folder to sync your notes across devices.
          </p>
          <button
            onClick={() => setStep('folder')}
            className="px-6 py-2.5 rounded-[var(--radius-sm)] bg-chrome text-ink font-medium hover:bg-pastel-blue transition-colors"
          >
            Get Started
          </button>
        </div>
      </div>
    );
  }

  if (step === 'creating') {
    return (
      <div className="h-full flex items-center justify-center bg-paper">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 mx-auto border-2 border-chrome border-t-transparent rounded-full animate-spin" />
          <p className="text-ink-2">Setting up your workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center bg-paper">
      <div className="max-w-md text-center space-y-6 p-8">
        <h2 className="text-2xl font-semibold text-ink">Choose Data Folder</h2>
        <p className="text-sm text-ink-2">
          Select a folder synced by iCloud, OneDrive, or Dropbox to enable cross-device sync.
        </p>

        <button
          onClick={handleSelectFolder}
          className="w-full px-4 py-3 rounded-[var(--radius-lg)] border border-dashed border-border-strong text-ink-2 hover:border-chrome hover:bg-paper-soft transition-colors"
        >
          {selectedDir ? (
            <span className="text-ink text-sm font-mono truncate block">{selectedDir}</span>
          ) : (
            'Click to select folder...'
          )}
        </button>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-3 justify-center">
          <button
            onClick={() => setStep('welcome')}
            className="px-5 py-2 rounded-[var(--radius-sm)] text-ink-2 hover:bg-paper-soft transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleComplete}
            disabled={!selectedDir}
            className="px-6 py-2 rounded-[var(--radius-sm)] bg-chrome text-ink font-medium hover:bg-pastel-blue transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create Workspace
          </button>
        </div>
      </div>
    </div>
  );
}
