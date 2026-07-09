import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { format } from 'date-fns';
import { useAppStore } from '../../stores/useAppStore';

/**
 * 일일 스냅샷 백업 복원 UI.
 *
 * 복원은 스냅샷의 notes/*.md, data/*.json을 원본 위로 덮어쓴다 —
 * 스냅샷 이후 새로 만든 파일은 지우지 않는다(덮어쓰기만).
 * 실행 직전 현재 상태를 pre-restore 스냅샷으로 한 번 더 떠 두므로
 * 복원 자체도 되돌릴 수 있다.
 */
export function BackupSection() {
  const { dataDir } = useAppStore();
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!dataDir) return;
    try {
      const backupRoot = await join(dataDir, 'backups');
      setSnapshots(await invoke<string[]>('list_snapshots', { backupRoot }));
    } catch {
      setSnapshots([]);
    }
  }, [dataDir]);

  useEffect(() => { load(); }, [load]);

  const restore = useCallback(async (stamp: string) => {
    if (!dataDir || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const backupRoot = await join(dataDir, 'backups');
      // 복원 직전 현재 상태를 보존 — 복원도 실수일 수 있다
      const preStamp = `${format(new Date(), 'yyyy-MM-dd_HHmmss')}_pre-restore`;
      await invoke('snapshot_data', { dataDir, backupRoot, stamp: preStamp, keep: 30 });
      const count = await invoke<number>('restore_snapshot', { dataDir, backupRoot, stamp });
      setMessage(`${count}개 파일 복원 완료 — 앱을 다시 불러옵니다...`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setMessage(`복원 실패: ${e instanceof Error ? e.message : e}`);
      setBusy(false);
    }
    setConfirming(null);
  }, [dataDir, busy]);

  const fmtStamp = (s: string) => {
    // 2026-07-09_142028 → 2026-07-09 14:20
    const m = s.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})/);
    const label = m ? `${m[1]} ${m[2]}:${m[3]}` : s;
    return s.endsWith('_pre-restore') ? `${label} (복원 전 자동 보존)` : label;
  };

  if (!snapshots.length) {
    return <p className="text-xs text-ink-3">아직 스냅샷이 없습니다. 백업은 하루 한 번 자동으로 생성됩니다.</p>;
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-ink-3">
        하루 한 번 자동 생성되는 스냅샷입니다. 복원하면 해당 시점의 노트/데이터가 현재 파일을
        덮어씁니다 (스냅샷 이후 새로 만든 파일은 유지). 복원 직전 상태도 자동 보존됩니다.
      </p>
      <div className="max-h-56 overflow-y-auto space-y-0.5 border border-border rounded-lg p-1.5">
        {snapshots.map((s) => (
          <div key={s} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-paper-soft/60">
            <span className="flex-1 text-xs text-ink-2 font-mono">{fmtStamp(s)}</span>
            {confirming === s ? (
              <>
                <span className="text-[10px] text-badge-high">이 시점으로 되돌릴까요?</span>
                <button
                  onClick={() => restore(s)}
                  disabled={busy}
                  className="px-2 py-0.5 text-[11px] rounded border border-badge-high text-badge-high hover:bg-badge-high-bg transition-colors disabled:opacity-50"
                >
                  {busy ? '복원 중...' : '복원 실행'}
                </button>
                <button
                  onClick={() => setConfirming(null)}
                  disabled={busy}
                  className="px-2 py-0.5 text-[11px] rounded border border-border text-ink-3 hover:bg-paper-soft transition-colors"
                >
                  취소
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirming(s)}
                disabled={busy}
                className="px-2 py-0.5 text-[11px] rounded border border-border text-ink-2 hover:bg-paper-soft transition-colors disabled:opacity-50"
              >
                복원...
              </button>
            )}
          </div>
        ))}
      </div>
      {message && <p className="text-xs text-ink-2">{message}</p>}
    </div>
  );
}
