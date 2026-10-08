import React, { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCameraStore } from '../store/cameraStore';
import { useSceneStore } from '../store/sceneStore';
import { polygonBounds } from '../core/parser';

export const WalkthroughControls: React.FC = () => {
  const { camera, gl } = useThree();
  const isWalkthroughActive = useCameraStore((state) => state.isWalkthroughActive);
  const setWalkthroughActive = useCameraStore((state) => state.setWalkthroughActive);
  const room = useSceneStore((state) => state.room);

  const keysPressed = useRef<{ [key: string]: boolean }>({});
  const isDraggingRef = useRef(false);
  const lastMousePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Yaw (horizontal) and Pitch (vertical) angles
  const yawRef = useRef(0);
  const pitchRef = useRef(0);

  // Initialize position on entry
  useEffect(() => {
    if (!isWalkthroughActive) return;

    // Place camera inside room center at 1.6m height
    const bounds = polygonBounds(room.outline);
    const centerX = (bounds.min[0] + bounds.max[0]) / 2;
    const centerZ = (bounds.min[1] + bounds.max[1]) / 2;

    camera.position.set(centerX, 1.6, centerZ);
    yawRef.current = 0;
    pitchRef.current = 0;
    camera.rotation.set(0, 0, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setWalkthroughActive(false);
        return;
      }
      keysPressed.current[e.code] = true;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysPressed.current[e.code] = false;
    };

    const dom = gl.domElement;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 0 || e.button === 2) {
        isDraggingRef.current = true;
        lastMousePos.current = { x: e.clientX, y: e.clientY };
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      lastMousePos.current = { x: e.clientX, y: e.clientY };

      const sensitivity = 0.003;
      yawRef.current -= dx * sensitivity;
      pitchRef.current -= dy * sensitivity;

      // Clamp pitch to avoid gimbal flip
      const maxPitch = (Math.PI / 2) * 0.92;
      pitchRef.current = Math.max(-maxPitch, Math.min(maxPitch, pitchRef.current));
    };

    const onPointerUp = () => {
      isDraggingRef.current = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [isWalkthroughActive, camera, gl.domElement, room.outline, setWalkthroughActive]);

  // Movement update per frame
  useFrame((_, delta) => {
    if (!isWalkthroughActive) return;

    // Apply rotation (order YXZ)
    const euler = new THREE.Euler(pitchRef.current, yawRef.current, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler);

    // Compute move direction based on keys
    const moveVector = new THREE.Vector3();
    const speed = 3.2; // 3.2 m/s walking speed
    const step = speed * delta;

    if (keysPressed.current['KeyW'] || keysPressed.current['ArrowUp']) {
      moveVector.z -= 1;
    }
    if (keysPressed.current['KeyS'] || keysPressed.current['ArrowDown']) {
      moveVector.z += 1;
    }
    if (keysPressed.current['KeyA'] || keysPressed.current['ArrowLeft']) {
      moveVector.x -= 1;
    }
    if (keysPressed.current['KeyD'] || keysPressed.current['ArrowRight']) {
      moveVector.x += 1;
    }

    if (moveVector.lengthSq() > 0) {
      moveVector.normalize();

      // Transform direction based on horizontal yaw only so camera stays level at 1.6m
      const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yawRef.current);
      const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yawRef.current);

      const deltaPos = new THREE.Vector3();
      deltaPos.addScaledVector(forward, -moveVector.z * step);
      deltaPos.addScaledVector(right, moveVector.x * step);

      camera.position.add(deltaPos);
      camera.position.y = 1.6; // Keep locked at 1.6 m eye height
    }
  });

  if (!isWalkthroughActive) return null;

  return null;
};

export default WalkthroughControls;
