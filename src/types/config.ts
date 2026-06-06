import type { Theme } from '../stores/useAppStore';

export interface EditorConfig {
  smart_transform: boolean;
  auto_tag_suggest: boolean;
  auto_subsystem_suggest: boolean;
  clipboard_capture: boolean;
  section_guides: boolean;
}

export interface TagRulesConfig {
  format: 'lowercase-hyphen' | 'lowercase' | 'as-is';
  require_confirmation_for_new: boolean;
}

export interface AutoArchiveConfig {
  quick_memo_days: number;
}

export interface NotificationsConfig {
  morning_briefing: boolean;
  evening_reminder: boolean;
  evening_reminder_time: string;
  friday_retro_reminder: boolean;
}

export interface WindowConfig {
  opacity_dock: number;
  opacity_sidebar: number;
  opacity_expanded: number;
  always_on_top_dock: boolean;
  always_on_top_sidebar: boolean;
  always_on_top_expanded: boolean;
  zoom_level: number;
}

export interface AppConfig {
  theme: Theme;
  pomodoro: {
    work: number;
    break: number;
    longBreak: number;
    sessionsBeforeLong: number;
  };
  window: WindowConfig;
  editor: EditorConfig;
  tag_rules: TagRulesConfig;
  auto_archive: AutoArchiveConfig;
  notifications: NotificationsConfig;
  dataDir?: string;
}

export const DEFAULT_EDITOR_CONFIG: EditorConfig = {
  smart_transform: true,
  auto_tag_suggest: true,
  auto_subsystem_suggest: true,
  clipboard_capture: true,
  section_guides: true,
};

export const DEFAULT_TAG_RULES: TagRulesConfig = {
  format: 'lowercase-hyphen',
  require_confirmation_for_new: true,
};

export const DEFAULT_AUTO_ARCHIVE: AutoArchiveConfig = {
  quick_memo_days: 14,
};

export const DEFAULT_NOTIFICATIONS: NotificationsConfig = {
  morning_briefing: true,
  evening_reminder: true,
  evening_reminder_time: '18:00',
  friday_retro_reminder: true,
};

export const DEFAULT_WINDOW_CONFIG: WindowConfig = {
  opacity_dock: 100,
  opacity_sidebar: 100,
  opacity_expanded: 100,
  always_on_top_dock: true,
  always_on_top_sidebar: true,
  always_on_top_expanded: false,
  zoom_level: 100,
};
