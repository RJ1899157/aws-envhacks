import React from 'react';
import { Canvas } from '../builder';
import { HeaderOverlay } from '../ui';

export const App: React.FC = () => {
  return (
    <main className="relative w-screen h-screen overflow-hidden bg-neutral-950">
      <Canvas />
      <HeaderOverlay />
    </main>
  );
};

export default App;
