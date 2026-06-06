import { invoke } from '@tauri-apps/api/core';
import { useAppStore, type AppView } from '../../stores/useAppStore';
import { useWorkhourTimerStore } from '../../stores/useWorkhourTimerStore';
import { useMusicStore } from '../../stores/useMusicStore';
import { useConfigStore } from '../../stores/useConfigStore';
import { OpacitySlider } from './TitleBar';

function formatWorkhour(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}H ${String(m).padStart(2, '0')}m`;
}

export function DockMode() {
  const { setView, setMode } = useAppStore();
  const workhour = useWorkhourTimerStore();
  const music = useMusicStore();
  const winCfg = useConfigStore((s) => s.window);

  async function openExpanded(view: AppView) {
    setView(view);
    setMode('expanded');
    try { await invoke('set_window_mode', { mode: 'expanded', alwaysOnTop: winCfg.always_on_top_expanded }); } catch {}
  }

  async function openSidebar() {
    setMode('sidebar');
    try { await invoke('set_window_mode', { mode: 'sidebar', alwaysOnTop: winCfg.always_on_top_sidebar }); } catch {}
  }

  function sendMusicCmd(cmd: 'toggle' | 'next' | 'prev') {
    window.dispatchEvent(new CustomEvent('music-cmd', { detail: cmd }));
  }

  const currentTrack = music.playlist.length > 0 ? music.playlist[music.currentIndex] : null;
  const hasPlaylist = music.playlist.length > 0;

  return (
    <div data-tauri-drag-region className="flex-1 flex flex-col items-center justify-center gap-1.5 p-2 overflow-hidden select-none">
      {/* Opacity slider */}
      <div className="w-full flex justify-center shrink-0">
        <OpacitySlider compact />
      </div>
      {/* Music controls */}
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={() => sendMusicCmd('prev')} disabled={!hasPlaylist}
          className="p-0.5 text-ink-3 hover:text-ink transition-colors disabled:opacity-20">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M10 3L5 7l5 4V3z" fill="currentColor"/>
            <path d="M4 3v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
        <button onClick={() => sendMusicCmd('toggle')} disabled={!hasPlaylist}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-chrome/30 text-ink hover:bg-chrome/50 transition-colors disabled:opacity-20">
          {music.playing ? (
            <svg width="10" height="10" viewBox="0 0 12 12"><rect x="2" y="1" width="3" height="10" rx="1" fill="currentColor"/><rect x="7" y="1" width="3" height="10" rx="1" fill="currentColor"/></svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5L3 1.5z" fill="currentColor"/></svg>
          )}
        </button>
        <button onClick={() => sendMusicCmd('next')} disabled={!hasPlaylist}
          className="p-0.5 text-ink-3 hover:text-ink transition-colors disabled:opacity-20">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M4 3l5 4-5 4V3z" fill="currentColor"/>
            <path d="M10 3v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
      {currentTrack && (
        <span className="text-[9px] text-ink-3 truncate max-w-[180px] text-center leading-none">
          {currentTrack.title}
        </span>
      )}

      <div className="w-full flex items-center gap-3 justify-center shrink-0">
        {/* Workhour */}
        <button
          onClick={() => { if (workhour.running) workhour.pause(); else workhour.start(); }}
          className="flex items-center gap-1 text-[11px] font-mono tabular-nums text-ink-2 hover:text-ink transition-colors"
          title={workhour.running ? 'Pause workhour' : 'Start workhour'}
        >
          {workhour.running ? (
            <svg width="9" height="9" viewBox="0 0 12 12" className="text-chrome">
              <rect x="2" y="1" width="3" height="10" rx="1" fill="currentColor"/><rect x="7" y="1" width="3" height="10" rx="1" fill="currentColor"/>
            </svg>
          ) : (
            <svg width="9" height="9" viewBox="0 0 12 12" className="text-ink-3">
              <path d="M3 1.5v9l7.5-4.5L3 1.5z" fill="currentColor"/>
            </svg>
          )}
          <span className={workhour.running ? 'text-chrome font-medium' : ''}>
            {formatWorkhour(workhour.elapsed)}
          </span>
        </button>

        <div className="w-px h-4 bg-border" />

        {/* Date */}
        <div className="flex items-center gap-0.5">
          <span className="text-base font-semibold text-ink leading-none">{new Date().getDate()}</span>
          <span className="text-[9px] text-ink-3 leading-none">
            {new Date().toLocaleDateString('ko-KR', { weekday: 'short' })}
          </span>
        </div>
      </div>

      {/* Mode buttons */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={openSidebar}
          title="Sidebar"
          className="px-2.5 py-0.5 text-[10px] text-ink-3 hover:text-ink hover:bg-paper-muted/60 rounded transition-colors"
        >
          Sidebar
        </button>
        <button
          onClick={() => openExpanded('daily')}
          title="Expand"
          className="px-2.5 py-0.5 text-[10px] text-ink-3 hover:text-ink hover:bg-paper-muted/60 rounded transition-colors"
        >
          Expand
        </button>
      </div>
    </div>
  );
}
