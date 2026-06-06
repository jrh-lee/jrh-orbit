export interface TagEntry {
  name: string;
  count: number;
  last_used: string;
}

export interface TagsFile {
  tags: TagEntry[];
  keyword_map: Record<string, string>;
}

export interface LinkEntry {
  forward: string[];
  backward: string[];
}

export type LinksFile = Record<string, LinkEntry>;

export interface SubsystemsFile {
  primary: string[];
  secondary: string[];
}

export interface WorkhourSession {
  project: string;
  startedAt: string;
  endedAt?: string;
  durationMinutes: number;
  source: 'pomodoro' | 'manual' | 'manual-timer';
  note?: string;
}

export interface DailyWorkhourFile {
  date: string;
  sessions: WorkhourSession[];
  total_minutes: number;
}

export const DEFAULT_TAGS_FILE: TagsFile = {
  tags: [],
  keyword_map: {
    'EKF': 'ekf',
    'Extended Kalman': 'ekf',
    'reaction wheel': 'reaction-wheel',
    'RW': 'reaction-wheel',
    '자이로': 'gyro-bias',
    'B-dot': 'b-dot',
    'b-dot': 'b-dot',
    '궤도결정': 'orbit-determination',
    'orbit determination': 'orbit-determination',
    'PID': 'pid',
    'magnetometer': 'magnetometer',
    '지자기': 'magnetometer',
    'SGP4': 'sgp4',
    'TLE': 'tle',
    'ADCS': 'adcs',
    '자세제어': 'adcs',
    'attitude': 'adcs',
  },
};

export const DEFAULT_LINKS_FILE: LinksFile = {};

export const DEFAULT_SUBSYSTEMS_FILE: SubsystemsFile = {
  primary: ['ADCS', 'Orbit'],
  secondary: ['OBC', 'EPS', 'COM', 'STR', 'Thermal', 'Payload'],
};

export interface TopicEntry {
  name: string;
  project: string;
  subsystem: string;
  created: string;
  note_count: number;
  last_used: string;
  keywords: string[];
}

export interface TopicsFile {
  topics: TopicEntry[];
}

export const DEFAULT_TOPICS_FILE: TopicsFile = {
  topics: [],
};
