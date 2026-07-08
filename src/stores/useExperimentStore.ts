import { create } from 'zustand';
import { readJsonFile, writeJsonFile } from '../lib/fileSystem';
import { FILES } from '../lib/constants';
import type { Experiment, ExperimentsFile } from '../types/experiment';

function newExperimentId(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface ExperimentState {
  experiments: Experiment[];
  loaded: boolean;
  load: (dataDir: string) => Promise<void>;
  add: (dataDir: string, exp: Omit<Experiment, 'id' | 'createdAt'>) => Promise<Experiment>;
  update: (dataDir: string, id: string, updates: Partial<Experiment>) => Promise<void>;
  remove: (dataDir: string, id: string) => Promise<void>;
}

async function persist(dataDir: string, experiments: Experiment[]) {
  const file: ExperimentsFile = { version: 1, experiments };
  await writeJsonFile(dataDir, FILES.experiments, file);
}

export const useExperimentStore = create<ExperimentState>((set, get) => ({
  experiments: [],
  loaded: false,

  load: async (dataDir) => {
    const file = await readJsonFile<ExperimentsFile>(dataDir, FILES.experiments);
    set({ experiments: file?.experiments ?? [], loaded: true });
  },

  add: async (dataDir, exp) => {
    const full: Experiment = { ...exp, id: newExperimentId(), createdAt: new Date().toISOString() };
    const experiments = [...get().experiments, full];
    set({ experiments });
    await persist(dataDir, experiments);
    return full;
  },

  update: async (dataDir, id, updates) => {
    const experiments = get().experiments.map((e) => (e.id === id ? { ...e, ...updates } : e));
    set({ experiments });
    await persist(dataDir, experiments);
  },

  remove: async (dataDir, id) => {
    const experiments = get().experiments.filter((e) => e.id !== id);
    set({ experiments });
    await persist(dataDir, experiments);
  },
}));

/** Experiments belonging to a project, active first. */
export function experimentsForProject(experiments: Experiment[], projectId: string): Experiment[] {
  const order = { active: 0, done: 1, archived: 2 } as const;
  return experiments
    .filter((e) => e.projectId === projectId)
    .sort((a, b) => (order[a.status] ?? 0) - (order[b.status] ?? 0) || a.name.localeCompare(b.name));
}
