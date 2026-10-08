import React, { useEffect, useState, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';

export const PerformanceOverlay: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault();
        setIsVisible(v => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!isVisible) return null;

  return (
    <Html center position={[0,0,0]} wrapperClass="pointer-events-none w-screen h-screen flex justify-start items-start">
      <Stats />
    </Html>
  );
};

const Stats: React.FC = () => {
  const { gl } = useThree();
  const [fps, setFps] = useState(0);
  const [drawCalls, setDrawCalls] = useState(0);
  const [triangles, setTriangles] = useState(0);
  const [geometries, setGeometries] = useState(0);
  const [textures, setTextures] = useState(0);
  
  const frameCount = useRef(0);
  const lastTime = useRef(performance.now());

  useFrame(() => {
    frameCount.current++;
    const now = performance.now();
    if (now - lastTime.current >= 1000) {
      setFps(Math.round((frameCount.current * 1000) / (now - lastTime.current)));
      frameCount.current = 0;
      lastTime.current = now;
      
      setDrawCalls(gl.info.render.calls);
      setTriangles(gl.info.render.triangles);
      setGeometries(gl.info.memory.geometries);
      setTextures(gl.info.memory.textures);
    }
  });

  return (
    <div className="absolute top-16 left-4 bg-black/80 text-green-400 font-mono text-xs p-3 rounded border border-green-900 pointer-events-none select-none z-50 min-w-[150px]">
      <div className="font-bold border-b border-green-900 pb-1 mb-1 text-white">Renderer Info</div>
      <div className="flex justify-between"><span>FPS:</span> <span className="text-white">{fps}</span></div>
      <div className="flex justify-between"><span>Draw Calls:</span> <span className="text-white">{drawCalls}</span></div>
      <div className="flex justify-between"><span>Triangles:</span> <span className="text-white">{triangles.toLocaleString()}</span></div>
      <div className="flex justify-between"><span>Geometries:</span> <span className="text-white">{geometries}</span></div>
      <div className="flex justify-between"><span>Textures:</span> <span className="text-white">{textures}</span></div>
    </div>
  );
};
