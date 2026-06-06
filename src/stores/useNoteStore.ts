import { create } from 'zustand';
import type { NoteMeta } from '../types/note';

interface NoteState {
  notes: NoteMeta[];
  activeNotePath: string | null;
  activeContent: string;

  setNotes: (notes: NoteMeta[]) => void;
  setActiveNote: (path: string | null) => void;
  setActiveContent: (content: string) => void;
}

export const useNoteStore = create<NoteState>((set) => ({
  notes: [],
  activeNotePath: null,
  activeContent: '',

  setNotes: (notes) => set({ notes }),
  setActiveNote: (path) => set({ activeNotePath: path }),
  setActiveContent: (content) => set({ activeContent: content }),
}));
