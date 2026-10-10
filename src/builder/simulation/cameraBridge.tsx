import React, { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type * as THREE from 'three';

/** The scene camera and canvas size, published by CameraBridge for DOM overlays outside the canvas. */
export const bridge: { camera: THREE.Camera | null; width: number; height: number } = { camera: null, width: 0, height: 0 };

/** Inside the R3F canvas: keeps `bridge` pointing at the current camera and canvas size. */
export const CameraBridge: React.FC = () => {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useFrame(() => {
    bridge.camera = camera;
    bridge.width = size.width;
    bridge.height = size.height;
  });
  useEffect(
    () => () => {
      bridge.camera = null;
    },
    []
  );
  return null;
};
