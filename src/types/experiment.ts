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
