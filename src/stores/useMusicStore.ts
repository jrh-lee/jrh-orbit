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

  setPlaylist: (pl: PlaylistItem[]) => void;
  setCurrentIndex: (idx: number) => void;
  setPlaying: (p: boolean) => void;
  cycleRepeat: () => void;
}

export const useMusicStore = create<MusicState>((set) => ({
  playlist: [],
  currentIndex: 0,
  playing: false,
  repeat: 'all',

  setPlaylist: (playlist) => set({ playlist }),
  setCurrentIndex: (currentIndex) => set({ currentIndex }),
  setPlaying: (playing) => set({ playing }),
  cycleRepeat: () => set((s) => {
    const modes: RepeatMode[] = ['all', 'one', 'off'];
    return { repeat: modes[(modes.indexOf(s.repeat) + 1) % modes.length] };
  }),
}));
