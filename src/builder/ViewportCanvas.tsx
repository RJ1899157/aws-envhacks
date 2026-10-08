import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';

export interface ViewportCanvasProps {
  className?: string;
}

export const ViewportCanvas: React.FC<ViewportCanvasProps> = ({ className = '' }) => {
  return (
    <div className={`relative w-full h-full ${className}`}>
      <Canvas
        camera={{ position: [8, 6, 8], fov: 45 }}
        gl={{ antialias: true }}
        className="w-full h-full bg-[#141416]"
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[10, 15, 10]} intensity={1.0} castShadow />
          <directionalLight position={[-10, 10, -10]} intensity={0.3} />

          {/* Floor grid on XZ plane (Y = 0) */}
          <Grid
            position={[0, -0.001, 0]}
            args={[20, 20]}
            cellSize={0.5}
            cellThickness={0.6}
            cellColor="#2e3038"
            sectionSize={2}
            sectionThickness={1.2}
            sectionColor="#4b5063"
            fadeDistance={30}
            fadeStrength={1}
          />

          <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
        </Suspense>
      </Canvas>
    </div>
  );
};
