import React from 'react';
import { Canvas } from '../builder';
import { AssetLibrary, Toolbar, Inspector, HudOverlay } from '../ui';

export const App: React.FC = () => {
  return (
    <main className="relative w-screen h-screen overflow-hidden bg-neutral-950 select-none">
      <Canvas />
      <Toolbar />
      <AssetLibrary />
      <Inspector />
      <HudOverlay />
    </main>
  );
};

export default App;
