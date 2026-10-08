import React from 'react';
import { ViewportCanvas } from '../builder';
import { HeaderOverlay } from '../ui';

export const App: React.FC = () => {
  return (
    <main className="relative w-screen h-screen overflow-hidden bg-neutral-950">
      <ViewportCanvas />
      <HeaderOverlay />
    </main>
  );
};

export default App;
