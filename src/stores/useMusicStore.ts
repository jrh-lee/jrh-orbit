import { create } from 'zustand';

export interface PlaylistItem {
  id: string;
  videoId: string;
  title: string;
}

export type RepeatMode = 'off' | 'one' | 'all';

interface MusicState {
  playlist: PlaylistItem[];
  currentIndex: number;
  playing: boolean;
  repeat: RepeatMode;
  /** 시크 바용 현재 재생 위치/전체 길이 (초) — 브리지가 0.5초마다 갱신 */
  position: number;
  duration: number;

  setPlaylist: (pl: PlaylistItem[]) => void;
  setCurrentIndex: (idx: number) => void;
  setPlaying: (p: boolean) => void;
  setTime: (position: number, duration: number) => void;
  cycleRepeat: () => void;
}

export const useMusicStore = create<MusicState>((set) => ({
  playlist: [],
  currentIndex: 0,
  playing: false,
  repeat: 'all',
  position: 0,
  duration: 0,

  setPlaylist: (playlist) => set({ playlist }),
  setCurrentIndex: (currentIndex) => set({ currentIndex }),
  setPlaying: (playing) => set({ playing }),
  setTime: (position, duration) => set({ position, duration }),
  cycleRepeat: () => set((s) => {
    const modes: RepeatMode[] = ['all', 'one', 'off'];
    return { repeat: modes[(modes.indexOf(s.repeat) + 1) % modes.length] };
  }),
}));
