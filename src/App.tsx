import { useEffect, useState } from 'react';
import { useAppStore } from './stores/useAppStore';
import { readJsonFile } from './lib/fileSystem';
import { FILES } from './lib/constants';
import { AppShell } from './components/layout/AppShell';
import { SetupWizard } from './components/layout/SetupWizard';

function App() {
  const { isSetupComplete, dataDir, setDataDir, setSetupComplete } = useAppStore();
  const [validating, setValidating] = useState(!!dataDir);

  useEffect(() => {
    if (!dataDir) { setValidating(false); return; }
    readJsonFile(dataDir, FILES.config).then((cfg) => {
      if (!cfg) {
        setDataDir('');
        setSetupComplete(false);
      }
      setValidating(false);
    });
  }, []);

  if (validating) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-paper gap-4">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
          <ellipse cx="32" cy="32" rx="26" ry="10" stroke="var(--color-chrome)" strokeWidth="2.5" className="animate-[spin_3s_linear_infinite]" style={{ transformOrigin: 'center' }}/>
          <ellipse cx="32" cy="32" rx="26" ry="10" stroke="var(--color-pastel-pink)" strokeWidth="2" className="animate-[spin_3s_linear_infinite_reverse]" style={{ transformOrigin: 'center', transform: 'rotate(60deg)' }}/>
          <circle cx="32" cy="32" r="4" fill="var(--color-chrome)"/>
        </svg>
        <div className="text-lg font-semibold text-ink tracking-wide">JRH-Orbit</div>
        <div className="w-5 h-5 border-2 border-chrome border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isSetupComplete) {
    return <SetupWizard />;
  }

  return <AppShell />;
}

export default App;
