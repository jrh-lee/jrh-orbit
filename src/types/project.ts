export interface Project {
  id: string;
  name: string;
  color: string;
  icon?: string;
  createdAt: string;
}

export interface ProjectsFile {
  version: number;
  projects: Project[];
}
