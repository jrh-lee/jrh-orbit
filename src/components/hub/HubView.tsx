import { useEffect } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useHubStore } from '../../stores/useHubStore';
import { loadProjectHubData, loadTopicHubData, loadExperimentHubData } from '../../lib/hubLoader';
import { ProjectHubView } from './ProjectHubView';
import { TopicHubView } from './TopicHubView';
import { ExperimentHubView } from './ExperimentHubView';
import { HubLanding } from './HubLanding';

export function HubView() {
  const { dataDir, hubTarget } = useAppStore();
  const { setProjectHubData, setTopicHubData, setExperimentHubData, setLoading, loading } = useHubStore();

  useEffect(() => {
    if (!dataDir || !hubTarget) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        if (hubTarget.type === 'project') {
          const data = await loadProjectHubData(dataDir, hubTarget.name);
          if (!cancelled) setProjectHubData(data);
        } else if (hubTarget.type === 'experiment') {
          const data = await loadExperimentHubData(dataDir, hubTarget.name, hubTarget.project);
          if (!cancelled) setExperimentHubData(data);
        } else {
          const data = await loadTopicHubData(dataDir, hubTarget.name);
          if (!cancelled && data) setTopicHubData(data);
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [dataDir, hubTarget, setProjectHubData, setTopicHubData, setExperimentHubData, setLoading]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
        로딩 중...
      </div>
    );
  }

  if (!hubTarget) {
    return <HubLanding />;
  }

  if (hubTarget.type === 'project') {
    return <ProjectHubView />;
  }

  if (hubTarget.type === 'experiment') {
    return <ExperimentHubView />;
  }

  return <TopicHubView />;
}
