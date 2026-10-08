import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { runExport, type ExportOptions } from '../io/export/exporters/ExportManager';


export const SceneExporter: React.FC = () => {
  const { scene } = useThree();

  useEffect(() => {
    const handleRunExport = (e: Event) => {
      const customEvent = e as CustomEvent<ExportOptions>;
      runExport(scene, customEvent.detail);
    };

    window.addEventListener('airforce:run-export', handleRunExport);
    return () => window.removeEventListener('airforce:run-export', handleRunExport);
  }, [scene]);

  return null;
};
