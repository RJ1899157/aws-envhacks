import React from 'react';
import { Canvas } from '../builder';
import { AssetLibrary, HeaderOverlay } from '../ui';

export const App: React.FC = () => {
  return (
    <main className="relative w-screen h-screen overflow-hidden bg-neutral-950">
      <Canvas />
      <HeaderOverlay />
      <AssetLibrary />
    </main>
  );
};

export default App;
