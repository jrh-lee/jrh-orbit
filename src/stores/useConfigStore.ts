import { create } from 'zustand';
import type { EditorConfig, TagRulesConfig, AutoArchiveConfig, NotificationsConfig, WindowConfig } from '../types/config';
import {
  DEFAULT_EDITOR_CONFIG,
  DEFAULT_TAG_RULES,
  DEFAULT_AUTO_ARCHIVE,
  DEFAULT_NOTIFICATIONS,
  DEFAULT_WINDOW_CONFIG,
} from '../types/config';

interface ConfigState {
  editor: EditorConfig;
  tag_rules: TagRulesConfig;
  auto_archive: AutoArchiveConfig;
  notifications: NotificationsConfig;
  window: WindowConfig;
  loaded: boolean;

  setEditor: (editor: Partial<EditorConfig>) => void;
  setTagRules: (rules: Partial<TagRulesConfig>) => void;
  setAutoArchive: (archive: Partial<AutoArchiveConfig>) => void;
  setNotifications: (notifs: Partial<NotificationsConfig>) => void;
  setWindow: (win: Partial<WindowConfig>) => void;
  loadFromConfig: (raw: Record<string, unknown>) => void;
  toConfigFields: () => {
    editor: EditorConfig;
    tag_rules: TagRulesConfig;
    auto_archive: AutoArchiveConfig;
    notifications: NotificationsConfig;
    window: WindowConfig;
  };
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  editor: { ...DEFAULT_EDITOR_CONFIG },
  tag_rules: { ...DEFAULT_TAG_RULES },
  auto_archive: { ...DEFAULT_AUTO_ARCHIVE },
  notifications: { ...DEFAULT_NOTIFICATIONS },
  window: { ...DEFAULT_WINDOW_CONFIG },
  loaded: false,

  setEditor: (partial) =>
    set((s) => ({ editor: { ...s.editor, ...partial } })),

  setTagRules: (partial) =>
    set((s) => ({ tag_rules: { ...s.tag_rules, ...partial } })),

  setAutoArchive: (partial) =>
    set((s) => ({ auto_archive: { ...s.auto_archive, ...partial } })),

  setNotifications: (partial) =>
    set((s) => ({ notifications: { ...s.notifications, ...partial } })),

  setWindow: (partial) =>
    set((s) => ({ window: { ...s.window, ...partial } })),

  loadFromConfig: (raw) => {
    const editor = raw.editor as Partial<EditorConfig> | undefined;
    const tagRules = raw.tag_rules as Partial<TagRulesConfig> | undefined;
    const autoArchive = raw.auto_archive as Partial<AutoArchiveConfig> | undefined;
    const notifications = raw.notifications as Partial<NotificationsConfig> | undefined;
    const windowCfg = raw.window as Partial<WindowConfig> | undefined;

    set({
      editor: { ...DEFAULT_EDITOR_CONFIG, ...editor },
      tag_rules: { ...DEFAULT_TAG_RULES, ...tagRules },
      auto_archive: { ...DEFAULT_AUTO_ARCHIVE, ...autoArchive },
      notifications: { ...DEFAULT_NOTIFICATIONS, ...notifications },
      window: { ...DEFAULT_WINDOW_CONFIG, ...windowCfg },
      loaded: true,
    });
  },

  toConfigFields: () => ({
    editor: get().editor,
    tag_rules: get().tag_rules,
    auto_archive: get().auto_archive,
    notifications: get().notifications,
    window: get().window,
  }),
}));
