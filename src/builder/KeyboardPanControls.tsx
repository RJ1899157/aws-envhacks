import React, { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useCameraStore } from '../store/cameraStore';
import { cameraController } from './cameraController';

const PAN_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * WASD / arrow keys slide the camera across the floor (camera and orbit target move together),
 * relative to where the camera is facing. Shift moves faster. Mouse drag still orbits.
 */
export const KeyboardPanControls: React.FC<{ controlsRef: React.RefObject<OrbitControlsImpl | null> }> = ({
  controlsRef,
}) => {
  const pressed = useRef(new Set<string>());
  const fast = useRef(false);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      fast.current = e.shiftKey;
      if (!(e.code in PAN_KEYS)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (useCameraStore.getState().isWalkthroughActive) return;
      e.preventDefault(); // keep arrow keys from scrolling the page
      pressed.current.add(e.code);
    };
    const onUp = (e: KeyboardEvent) => {
      fast.current = e.shiftKey;
      pressed.current.delete(e.code);
    };
    const clear = () => pressed.current.clear();
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', clear);
    };
  }, []);

  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());
  const move = useRef(new THREE.Vector3());

  useFrame(({ camera }, delta) => {
    const controls = controlsRef.current;
    if (!controls || pressed.current.size === 0) return;

    let fx = 0;
    let fy = 0;
    for (const code of pressed.current) {
      const dir = PAN_KEYS[code];
      if (dir) {
        fx += dir[0];
        fy += dir[1];
      }
    }
    if (fx === 0 && fy === 0) return;
    cameraController.cancelAnimation();

    // "Forward" is where the camera looks, flattened onto the floor; looking straight down, use screen-up
    camera.getWorldDirection(forward.current);
    forward.current.y = 0;
    if (forward.current.lengthSq() < 1e-4) {
      forward.current.copy(camera.up).applyQuaternion(camera.quaternion);
      forward.current.y = 0;
    }
    forward.current.normalize();
    right.current.crossVectors(forward.current, UP).normalize();

    // Speed scales with how much floor is on screen, so it feels the same zoomed in or out
    const ortho = camera as THREE.OrthographicCamera;
    const viewSpan = ortho.isOrthographicCamera
      ? (ortho.top - ortho.bottom) / ortho.zoom
      : camera.position.distanceTo(controls.target);
    const speed = Math.max(1, viewSpan * 0.3) * (fast.current ? 2.5 : 1);

    move.current
      .copy(forward.current)
      .multiplyScalar(fy)
      .addScaledVector(right.current, fx)
      .normalize()
      .multiplyScalar(speed * Math.min(delta, 0.1));

    camera.position.add(move.current);
    controls.target.add(move.current);
    controls.update();
  });

  return null;
};
