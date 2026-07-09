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

  const backupNow = useCallback(async () => {
    if (!dataDir || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const backupRoot = await join(dataDir, 'backups');
      const stamp = `${format(new Date(), 'yyyy-MM-dd_HHmmss')}_manual`;
      const count = await invoke<number>('snapshot_data', { dataDir, backupRoot, stamp, keep: 30 });
      setMessage(`스냅샷 생성 완료 (${count}개 파일)`);
      await load();
    } catch (e) {
      setMessage(`백업 실패: ${e instanceof Error ? e.message : e}`);
    }
    setBusy(false);
  }, [dataDir, busy, load]);

  const fmtStamp = (s: string) => {
    // 2026-07-09_142028 → 2026-07-09 14:20
    const m = s.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})/);
    const label = m ? `${m[1]} ${m[2]}:${m[3]}` : s;
    if (s.endsWith('_pre-restore')) return `${label} (복원 전 자동 보존)`;
    if (s.endsWith('_manual')) return `${label} (수동)`;
    return label;
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-3">
          하루 한 번 자동 생성되는 스냅샷입니다. 복원하면 해당 시점의 노트/데이터가 현재 파일을
          덮어씁니다 (스냅샷 이후 새로 만든 파일은 유지). 복원 직전 상태도 자동 보존됩니다.
        </p>
        <button
          onClick={backupNow}
          disabled={busy}
          className="px-2.5 py-1 text-[11px] rounded-lg border border-border text-ink-2 hover:bg-paper-soft transition-colors disabled:opacity-50 shrink-0"
        >
          {busy ? '백업 중...' : '지금 백업 만들기'}
        </button>
      </div>
      {!snapshots.length && (
        <p className="text-xs text-ink-3">아직 스냅샷이 없습니다.</p>
      )}
      {snapshots.length > 0 && (
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
      )}
      {message && <p className="text-xs text-ink-2">{message}</p>}
    </div>
  );
}
