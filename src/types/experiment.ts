export type ExperimentStatus = 'active' | 'done' | 'archived';

export interface Experiment {
  id: string;
  name: string;
  /** Parent project id (Project.id in data/projects.json) */
  projectId: string;
  description?: string;
  status: ExperimentStatus;
  createdAt: string;
}

export interface ExperimentsFile {
  version: number;
  experiments: Experiment[];
}

export const DEFAULT_EXPERIMENTS_FILE: ExperimentsFile = {
  version: 1,
  experiments: [],
};

const EXPERIMENT_EMOJIS = ['🧪', '🔬', '🚀', '🛰️', '📡', '⚙️', '🔭', '🧲', '💡', '🌡️', '🎯', '🪐', '⚡', '🔋', '📐', '🌀'];

/** Deterministic per-name emoji — same experiment always gets the same one. */
export function experimentEmoji(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return EXPERIMENT_EMOJIS[h % EXPERIMENT_EMOJIS.length];
}
