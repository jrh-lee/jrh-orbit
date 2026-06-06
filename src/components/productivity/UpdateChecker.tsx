import { useState, useEffect } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function UpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [version, setVersion] = useState('');
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function checkForUpdate() {
      try {
        const update = await check();
        if (cancelled || !update) return;
        setUpdateAvailable(true);
        setVersion(update.version);
      } catch {}
    }

    const timer = setTimeout(checkForUpdate, 5000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  async function handleUpdate() {
    setInstalling(true);
    try {
      const update = await check();
      if (!update) return;

      setProgress('Downloading...');
      await update.downloadAndInstall((e) => {
        if (e.event === 'Started' && e.data.contentLength) {
          setProgress(`0 / ${Math.round(e.data.contentLength / 1024)}KB`);
        } else if (e.event === 'Progress') {
          setProgress(`${Math.round(e.data.chunkLength / 1024)}KB`);
        } else if (e.event === 'Finished') {
          setProgress('Restarting...');
        }
      });
      await getCurrentWindow().close();
    } catch {
      setInstalling(false);
      setProgress('Update failed');
    }
  }

  if (!updateAvailable) return null;

  return (
    <div className="fixed bottom-8 right-4 z-50 bg-paper border border-chrome rounded-xl shadow-lg p-3 max-w-[260px]">
      <div className="text-xs font-medium text-ink mb-1">
        Update Available: v{version}
      </div>
      {installing ? (
        <div className="text-[11px] text-ink-3">{progress}</div>
      ) : (
        <div className="flex gap-2 mt-2">
          <button
            onClick={handleUpdate}
            className="px-3 py-1 text-xs rounded-lg bg-chrome text-paper font-medium hover:opacity-90 transition-opacity"
          >
            Install & Restart
          </button>
          <button
            onClick={() => setUpdateAvailable(false)}
            className="px-2 py-1 text-xs text-ink-3 hover:text-ink transition-colors"
          >
            Later
          </button>
        </div>
      )}
    </div>
  );
}
