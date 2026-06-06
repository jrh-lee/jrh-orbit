import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useMusicStore, type PlaylistItem } from '../../stores/useMusicStore';
import { readJsonFile, writeJsonFile } from '../../lib/fileSystem';
import { FILES } from '../../lib/constants';

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([^&\s]+)/,
    /(?:youtu\.be\/)([^?\s]+)/,
    /(?:youtube\.com\/embed\/)([^?\s]+)/,
    /(?:youtube\.com\/shorts\/)([^?\s]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function fetchVideoTitle(videoId: string): Promise<string> {
  try {
    const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
    const data = await res.json();
    if (data.title) return data.title;
  } catch {}
  return `Video ${videoId}`;
}

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

let apiLoaded = false;
function loadYTApi(): Promise<void> {
  if (apiLoaded && window.YT?.Player) return Promise.resolve();
  return new Promise((resolve) => {
    if (window.YT?.Player) { apiLoaded = true; resolve(); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      apiLoaded = true;
      prev?.();
      resolve();
    };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
  });
}

// ─── Engine: always mounted in AppShell, manages YouTube player ───

interface PlaylistFile {
  items: PlaylistItem[];
  lastIndex: number;
}

export function MusicEngine() {
  const { dataDir } = useAppStore();
  const { playlist, currentIndex } = useMusicStore();
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevVideoIdRef = useRef<string | null>(null);
  const loadedRef = useRef(false);

  const loadPlaylist = useCallback(() => {
    if (!dataDir) return;
    readJsonFile<PlaylistFile>(dataDir, FILES.playlist).then(async (data) => {
      if (data?.items?.length) {
        const s = useMusicStore.getState();
        s.setPlaylist(data.items);
        s.setCurrentIndex(Math.min(data.lastIndex ?? 0, data.items.length - 1));
        loadedRef.current = true;
        return;
      }
      const legacy = await readJsonFile<{ playlist?: PlaylistItem[]; lastIndex?: number }>(dataDir, FILES.config);
      if (legacy?.playlist?.length) {
        const s = useMusicStore.getState();
        s.setPlaylist(legacy.playlist);
        s.setCurrentIndex(Math.min(legacy.lastIndex ?? 0, legacy.playlist.length - 1));
        writeJsonFile(dataDir, FILES.playlist, { items: legacy.playlist, lastIndex: legacy.lastIndex ?? 0 }).catch(() => {});
      }
      loadedRef.current = true;
    });
  }, [dataDir]);

  useEffect(() => {
    loadPlaylist();
  }, [loadPlaylist]);

  useEffect(() => {
    const handler = () => loadPlaylist();
    window.addEventListener('playlist-changed', handler);
    return () => window.removeEventListener('playlist-changed', handler);
  }, [loadPlaylist]);

  useEffect(() => {
    if (!dataDir || !loadedRef.current) return;
    writeJsonFile(dataDir, FILES.playlist, { items: playlist, lastIndex: currentIndex }).catch(() => {});
  }, [dataDir, playlist, currentIndex]);

  const handleEndedRef = useRef<() => void>(() => {});
  handleEndedRef.current = () => {
    const { playlist, currentIndex, repeat, setCurrentIndex, setPlaying } = useMusicStore.getState();
    if (repeat === 'one') {
      playerRef.current?.seekTo(0);
      playerRef.current?.playVideo();
    } else if (repeat === 'all' || currentIndex < playlist.length - 1) {
      const next = (currentIndex + 1) % playlist.length;
      setPlaying(true);
      setCurrentIndex(next);
    } else {
      setPlaying(false);
    }
  };

  useEffect(() => {
    if (playlist.length === 0) {
      if (playerRef.current) {
        playerRef.current.stopVideo();
        useMusicStore.getState().setPlaying(false);
      }
      prevVideoIdRef.current = null;
      return;
    }
    const item = playlist[currentIndex];
    if (!item) return;

    if (prevVideoIdRef.current === item.videoId && playerRef.current) return;
    prevVideoIdRef.current = item.videoId;

    const shouldPlay = useMusicStore.getState().playing;
    loadYTApi().then(() => {
      if (playerRef.current) {
        if (shouldPlay) playerRef.current.loadVideoById(item.videoId);
        else playerRef.current.cueVideoById(item.videoId);
        return;
      }
      if (!containerRef.current) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        height: '0',
        width: '0',
        videoId: item.videoId,
        playerVars: { autoplay: shouldPlay ? 1 : 0, controls: 0 },
        events: {
          onReady: () => { if (useMusicStore.getState().playing) useMusicStore.getState().setPlaying(true); },
          onStateChange: (e: any) => {
            if (e.data === window.YT.PlayerState.PLAYING) useMusicStore.getState().setPlaying(true);
            if (e.data === window.YT.PlayerState.PAUSED) useMusicStore.getState().setPlaying(false);
            if (e.data === window.YT.PlayerState.ENDED) handleEndedRef.current();
          },
        },
      });
    });
  }, [playlist, currentIndex]);

  useEffect(() => {
    function handler(e: Event) {
      const cmd = (e as CustomEvent).detail;
      const player = playerRef.current;
      const state = useMusicStore.getState();

      if (cmd === 'toggle') {
        if (!player) return;
        if (state.playing) player.pauseVideo();
        else player.playVideo();
      } else if (cmd === 'next') {
        if (state.playlist.length === 0) return;
        const next = (state.currentIndex + 1) % state.playlist.length;
        state.setPlaying(true);
        state.setCurrentIndex(next);
      } else if (cmd === 'prev') {
        if (state.playlist.length === 0) return;
        const prev = (state.currentIndex - 1 + state.playlist.length) % state.playlist.length;
        state.setPlaying(true);
        state.setCurrentIndex(prev);
      }
    }
    window.addEventListener('music-cmd', handler);
    return () => window.removeEventListener('music-cmd', handler);
  }, []);

  return (
    <div className="fixed -left-[9999px] -top-[9999px] w-0 h-0 overflow-hidden" aria-hidden>
      <div ref={containerRef} />
    </div>
  );
}

// ─── UI: rendered in StatusBar, pure presentation + store updates ───

export function MusicPlayer() {
  const store = useMusicStore();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (toggleRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function sendCommand(cmd: 'toggle' | 'next' | 'prev') {
    window.dispatchEvent(new CustomEvent('music-cmd', { detail: cmd }));
  }

  async function handleAdd() {
    const vid = extractVideoId(url.trim());
    if (!vid) return;
    setAdding(true);
    const title = await fetchVideoTitle(vid);
    const item: PlaylistItem = {
      id: Math.random().toString(36).substring(2, 8),
      videoId: vid,
      title,
    };
    const updated = [...store.playlist, item];
    if (store.playlist.length === 0) {
      store.setPlaying(true);
    }
    store.setPlaylist(updated);
    if (store.playlist.length === 0) {
      store.setCurrentIndex(0);
    }
    setUrl('');
    setAdding(false);
  }

  function removeFromPlaylist(idx: number) {
    const updated = store.playlist.filter((_, i) => i !== idx);
    let newIdx = store.currentIndex;
    if (idx < store.currentIndex) newIdx--;
    if (idx === store.currentIndex) {
      newIdx = Math.min(store.currentIndex, updated.length - 1);
    }
    if (newIdx < 0) newIdx = 0;
    store.setPlaylist(updated);
    store.setCurrentIndex(newIdx);
  }

  function playAt(idx: number) {
    store.setPlaying(true);
    store.setCurrentIndex(idx);
  }

  const repeatLabel = store.repeat === 'off' ? 'Repeat: Off' : store.repeat === 'one' ? 'Repeat: One' : 'Repeat: All';
  const currentItem = store.playlist[store.currentIndex];

  return (
    <>
      <button ref={toggleRef} onClick={() => setOpen(!open)} title="Music Player"
        className="flex items-center gap-1 text-ink-3 hover:text-ink transition-colors">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="3.5" cy="9" r="1.5" stroke="currentColor" strokeWidth="1"/>
          <circle cx="9.5" cy="8" r="1.5" stroke="currentColor" strokeWidth="1"/>
          <path d="M5 9V2.5L11 1.5V8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {store.playing && <span className="w-1.5 h-1.5 rounded-full bg-pastel-mint animate-pulse" />}
      </button>

      {open && (
        <div ref={panelRef} className="fixed bottom-8 right-3 w-[320px] bg-paper border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-paper-soft">
            <span className="text-xs font-medium text-ink">Music Player</span>
            <button onClick={() => setOpen(false)} className="text-ink-3 hover:text-ink transition-colors">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          {currentItem && (
            <div className="px-3 py-2 border-b border-border/50">
              <div className="text-[10px] text-ink-3 mb-0.5">Now Playing</div>
              <div className="text-xs text-ink truncate">{currentItem.title}</div>
            </div>
          )}

          <div className="flex items-center justify-center gap-3 py-2.5 border-b border-border/50">
            <button onClick={store.cycleRepeat} title={repeatLabel}
              className={`p-1.5 rounded transition-colors ${store.repeat !== 'off' ? 'text-chrome' : 'text-ink-3 hover:text-ink'}`}>
              <RepeatIcon mode={store.repeat} />
            </button>
            <button onClick={() => sendCommand('prev')} title="Previous" className="p-1.5 rounded text-ink-2 hover:text-ink transition-colors">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M10 3L5 7l5 4V3z" fill="currentColor"/>
                <path d="M4 3v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            <button onClick={() => sendCommand('toggle')} title={store.playing ? 'Pause' : 'Play'}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-chrome/30 text-ink hover:bg-chrome/50 transition-colors">
              <PlayPauseIcon playing={store.playing} size={14} />
            </button>
            <button onClick={() => sendCommand('next')} title="Next" className="p-1.5 rounded text-ink-2 hover:text-ink transition-colors">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M4 3l5 4-5 4V3z" fill="currentColor"/>
                <path d="M10 3v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            <span className="text-[10px] text-ink-3 min-w-[16px] text-center">
              {store.playlist.length > 0 ? `${store.currentIndex + 1}/${store.playlist.length}` : ''}
            </span>
          </div>

          <div className="px-2 pt-2 pb-1">
            <form onSubmit={(e) => { e.preventDefault(); handleAdd(); }} className="flex gap-1">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="YouTube URL..."
                className="flex-1 px-2 py-1 text-xs rounded border border-border bg-paper-soft text-ink placeholder:text-ink-3 focus:outline-none focus:border-chrome" />
              <button type="submit" disabled={adding}
                className="px-2 py-1 text-[10px] rounded bg-chrome/30 text-ink font-medium hover:bg-chrome/50 transition-colors disabled:opacity-50">
                {adding ? '...' : 'Add'}
              </button>
            </form>
          </div>

          <div className="max-h-36 overflow-y-auto px-1 pb-2">
            {store.playlist.length === 0 && (
              <p className="text-[10px] text-ink-3 text-center py-3">Paste YouTube URLs to build a playlist</p>
            )}
            {store.playlist.map((item, idx) => (
              <div key={item.id}
                className={`flex items-center gap-1 px-1.5 py-1 rounded text-xs group transition-colors cursor-pointer ${
                  idx === store.currentIndex ? 'bg-chrome/15 text-ink' : 'text-ink-2 hover:bg-paper-soft'
                }`}
                onClick={() => playAt(idx)}>
                {idx === store.currentIndex && store.playing && (
                  <span className="w-1.5 h-1.5 rounded-full bg-pastel-mint animate-pulse shrink-0" />
                )}
                <span className="flex-1 truncate text-[11px]">{item.title}</span>
                <button onClick={(e) => { e.stopPropagation(); removeFromPlaylist(idx); }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-ink-3 hover:text-red-400 transition-all">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M3 3l4 4M7 3l-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Shared sub-components ───

function PlayPauseIcon({ playing, size }: { playing: boolean; size: number }) {
  if (playing) return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <rect x="3" y="2" width="3" height="10" rx="1" fill="currentColor"/>
      <rect x="8" y="2" width="3" height="10" rx="1" fill="currentColor"/>
    </svg>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M4 2.5v9l8-4.5-8-4.5z" fill="currentColor"/>
    </svg>
  );
}

function RepeatIcon({ mode }: { mode: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 5a5 5 0 018.5-2M12 9a5 5 0 01-8.5 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M12 2v3h-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 12V9h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      {mode === 'one' && <text x="6" y="8.5" fontSize="5" fill="currentColor" textAnchor="middle" fontWeight="bold">1</text>}
    </svg>
  );
}

export function DockMusicWidget() {
  const { playlist, currentIndex, playing } = useMusicStore();

  if (playlist.length === 0) return null;

  const currentItem = playlist[currentIndex];

  function sendCommand(cmd: 'toggle' | 'next' | 'prev') {
    window.dispatchEvent(new CustomEvent('music-cmd', { detail: cmd }));
  }

  return (
    <div className="flex flex-col items-center gap-0.5 py-1">
      <div className="w-8 h-px bg-border mb-1" />
      {currentItem && (
        <div className="w-11 text-center">
          <span className="text-[7px] text-ink-3 truncate block leading-tight">
            {currentItem.title.length > 12 ? currentItem.title.slice(0, 12) + '..' : currentItem.title}
          </span>
        </div>
      )}
      <div className="flex items-center gap-0.5">
        <button onClick={() => sendCommand('prev')} className="p-0.5 text-ink-3 hover:text-ink transition-colors">
          <svg width="8" height="8" viewBox="0 0 14 14" fill="none">
            <path d="M10 3L5 7l5 4V3z" fill="currentColor"/>
            <path d="M4 3v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
        <button onClick={() => sendCommand('toggle')}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-chrome/30 text-ink hover:bg-chrome/50 transition-colors">
          <PlayPauseIcon playing={playing} size={8} />
        </button>
        <button onClick={() => sendCommand('next')} className="p-0.5 text-ink-3 hover:text-ink transition-colors">
          <svg width="8" height="8" viewBox="0 0 14 14" fill="none">
            <path d="M4 3l5 4-5 4V3z" fill="currentColor"/>
            <path d="M10 3v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
