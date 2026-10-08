import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { polygonBounds } from '../core/parser';
import { prefersReducedMotion } from '../core/motion';
import type { Room } from '../core/types';
import { useCameraStore } from '../store/cameraStore';
import { useUiStore } from '../store/uiStore';

export interface CameraAnimationOptions {
  duration?: number;
  easing?: (t: number) => number;
  onComplete?: () => void;
}

// Ease-out cubic: smooth deceleration
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

// Ease-in-out cubic: smooth start and end
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const safeRequestAnimationFrame = (cb: FrameRequestCallback): number => {
  if (typeof requestAnimationFrame !== 'undefined') return requestAnimationFrame(cb);
  return setTimeout(() => cb(performance.now()), 16) as unknown as number;
};

const safeCancelAnimationFrame = (id: number): void => {
  if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(id);
  else clearTimeout(id);
};

class SharedCameraController {
  private activeAnimationId: number | null = null;
  private isAnimating = false;

  public isAnimationActive(): boolean {
    return this.isAnimating;
  }

  public cancelAnimation(): void {
    if (this.activeAnimationId !== null) {
      safeCancelAnimationFrame(this.activeAnimationId);
      this.activeAnimationId = null;
    }
    this.isAnimating = false;
  }

  /**
   * Main animated transition for camera position and controls look-at target.
   * Cancellable by user drag at any time.
   */
  public animateTo(
    camera: THREE.Camera,
    controls: OrbitControlsImpl | null,
    targetCamPos: THREE.Vector3,
    targetLookAt: THREE.Vector3,
    options: CameraAnimationOptions = {}
  ): void {
    this.cancelAnimation();

    if (prefersReducedMotion()) {
      camera.position.copy(targetCamPos);
      if (controls) {
        controls.target.copy(targetLookAt);
        controls.update();
      }
      options.onComplete?.();
      return;
    }

    const duration = options.duration ?? 500; // 500 ms standard
    const easing = options.easing ?? easeOutCubic;

    const startPos = camera.position.clone();
    const startTarget = controls ? controls.target.clone() : targetLookAt.clone();
    const startTime = performance.now();

    this.isAnimating = true;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easing(progress);

      camera.position.lerpVectors(startPos, targetCamPos, eased);

      if (controls) {
        controls.target.lerpVectors(startTarget, targetLookAt, eased);
        controls.update();
      }

      if (progress < 1) {
        this.activeAnimationId = safeRequestAnimationFrame(tick);
      } else {
        camera.position.copy(targetCamPos);
        if (controls) {
          controls.target.copy(targetLookAt);
          controls.update();
        }
        this.isAnimating = false;
        this.activeAnimationId = null;
        options.onComplete?.();
      }
    };

    this.activeAnimationId = safeRequestAnimationFrame(tick);
  }

  /**
   * Helper to calculate room bounding center and ideal framing distance
   */
  public getRoomFraming(room: Room): { center: THREE.Vector3; distance: number; maxDim: number } {
    const bounds = polygonBounds(room.outline);
    const center = new THREE.Vector3(
      (bounds.min[0] + bounds.max[0]) / 2,
      (room.wallHeight || 2.8) * 0.4,
      (bounds.min[1] + bounds.max[1]) / 2
    );
    const width = bounds.width;
    const depth = bounds.depth;
    const maxDim = Math.max(width, depth, 3.5);
    const distance = maxDim * 1.7;
    return { center, distance, maxDim };
  }

  /**
   * Go to one of the standard presets: perspective, isometric, top, front, back, right, left
   */
  public goToPreset(
    preset: 'perspective' | 'isometric' | 'top' | 'bottom' | 'front' | 'back' | 'right' | 'left',
    room: Room,
    camera: THREE.Camera,
    controls: OrbitControlsImpl | null,
    options?: CameraAnimationOptions
  ): void {
    const { center, distance } = this.getRoomFraming(room);
    const targetLookAt = center.clone();
    // Keep the orbit target safely above the floor. A floor-level look-at is
    // fine for top view, but produces a below-floor polar angle for side views.
    targetLookAt.y = preset === 'top' ? 0 : Math.max(0.5, center.y);

    const targetPos = new THREE.Vector3();

    switch (preset) {
      case 'top':
        targetPos.set(center.x, distance * 1.5, center.z + 0.0001);
        break;
      case 'bottom':
        // Bottom is intentionally mapped to a high top-down view: the camera
        // must never move below the room floor.
        targetPos.set(center.x, distance * 1.5, center.z + 0.0001);
        break;
      case 'front':
        targetPos.set(center.x, center.y + 1.2, center.z + distance);
        break;
      case 'back':
        targetPos.set(center.x, center.y + 1.2, center.z - distance);
        break;
      case 'right':
        targetPos.set(center.x + distance, center.y + 1.2, center.z);
        break;
      case 'left':
        targetPos.set(center.x - distance, center.y + 1.2, center.z);
        break;
      case 'isometric':
        targetPos.set(
          center.x + distance * 0.8,
          center.y + distance * 0.8,
          center.z + distance * 0.8
        );
        break;
      case 'perspective':
      default:
        targetPos.set(
          center.x + distance * 0.7,
          center.y + distance * 0.55,
          center.z + distance * 0.7
        );
        break;
    }

    // If switching from top/2D mode to a 3D preset, ensure uiStore view mode is set to 3D
    if (preset !== 'top' && useUiStore.getState().view === '2d') {
      useUiStore.getState().setView('3d');
    }

    this.animateTo(camera, controls, targetPos, targetLookAt, {
      duration: options?.duration ?? 500,
      easing: easeInOutCubic,
      ...options,
    });
  }

  /**
   * Fit the entire room inside the camera view
   */
  public fitRoom(
    room: Room,
    camera: THREE.Camera,
    controls: OrbitControlsImpl | null,
    options?: CameraAnimationOptions
  ): void {
    const is2D = useUiStore.getState().view === '2d';
    if (is2D) {
      this.goToPreset('top', room, camera, controls, options);
    } else {
      this.goToPreset('perspective', room, camera, controls, options);
    }
  }

  /**
   * Fly and frame a specific selected object
   */
  public fitSelection(
    selectedId: string | null,
    room: Room,
    camera: THREE.Camera,
    controls: OrbitControlsImpl | null,
    options?: CameraAnimationOptions
  ): void {
    if (!selectedId) {
      this.fitRoom(room, camera, controls, options);
      return;
    }

    const obj = room.objects.find((o) => o.id === selectedId);
    if (!obj) {
      this.fitRoom(room, camera, controls, options);
      return;
    }

    const elev = obj.elevation ?? 0;
    const targetPos = new THREE.Vector3(
      obj.position[0],
      (obj.position[1] ?? 0) + elev + obj.size[1] / 2,
      obj.position[2]
    );

    const maxDim = Math.max(...obj.size, 1.0);
    const dist = maxDim * 2.5;

    const camTargetPos = new THREE.Vector3(
      targetPos.x + dist * 0.7,
      targetPos.y + dist * 0.6,
      targetPos.z + dist * 0.7
    );

    this.animateTo(camera, controls, camTargetPos, targetPos, {
      duration: options?.duration ?? 500,
      easing: easeOutCubic,
      ...options,
    });
  }

  /**
   * Nudge camera orbit around target by degrees
   */
  public nudgeOrbit(
    deltaDegH: number,
    deltaDegV: number,
    camera: THREE.Camera,
    controls: OrbitControlsImpl | null
  ): void {
    if (!controls) return;
    this.cancelAnimation();

    const target = controls.target;
    const offset = camera.position.clone().sub(target);

    // Convert to spherical coords
    const spherical = new THREE.Spherical().setFromVector3(offset);

    spherical.theta += (deltaDegH * Math.PI) / 180;
    spherical.phi = Math.max(
      0.05,
      Math.min(Math.PI / 2 - 0.05, spherical.phi - (deltaDegV * Math.PI) / 180)
    );

    const targetPos = target.clone().add(new THREE.Vector3().setFromSpherical(spherical));

    this.animateTo(camera, controls, targetPos, target, {
      duration: 180,
      easing: easeOutCubic,
    });
  }

  /**
   * Recentre orbit pivot to a point in world space
   */
  public recenterPivot(
    point: THREE.Vector3,
    camera: THREE.Camera,
    controls: OrbitControlsImpl | null
  ): void {
    if (!controls) return;
    this.cancelAnimation();

    const targetLookAt = point.clone();
    targetLookAt.y = Math.max(0, targetLookAt.y);

    const diff = camera.position.clone().sub(controls.target);
    const targetCamPos = targetLookAt.clone().add(diff);

    this.animateTo(camera, controls, targetCamPos, targetLookAt, {
      duration: 350,
      easing: easeOutCubic,
    });
  }

  /**
   * Smoothly toggles between perspective and orthographic camera while matching framing
   */
  public toggleProjectionPreservingFraming(
    camera: THREE.Camera,
    controls: OrbitControlsImpl | null
  ): void {
    const currentProj = useCameraStore.getState().projection;
    const nextProj = currentProj === 'perspective' ? 'orthographic' : 'perspective';
    // Ease the perspective FOV through the store, and set projection after the
    // transition. The ortho camera is sized from the same visible span.

    // Match the visible vertical span when the Canvas swaps camera instances.
    // The camera's world position and controls target remain untouched.
    if (nextProj === 'orthographic' && controls) {
      const dist = camera.position.distanceTo(controls.target);
      const fovRad = ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 180;
      const visibleHeight = 2 * Math.tan(fovRad / 2) * dist;
      if ('zoom' in camera) {
        const winHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
        const startZoom = (camera as THREE.OrthographicCamera).zoom;
        const endZoom = winHeight / (visibleHeight || 1);
        const started = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - started) / 500);
          const eased = easeInOutCubic(t);
          (camera as THREE.OrthographicCamera).zoom = startZoom + (endZoom - startZoom) * eased;
          (camera as THREE.OrthographicCamera).updateProjectionMatrix();
          if (t < 1) this.activeAnimationId = safeRequestAnimationFrame(tick);
          else {
            this.activeAnimationId = null;
            this.isAnimating = false;
            useCameraStore.getState().setProjection(nextProj);
          }
        };
        this.cancelAnimation();
        this.isAnimating = true;
        this.activeAnimationId = safeRequestAnimationFrame(tick);
        return;
      }
    }
    useCameraStore.getState().setProjection(nextProj);
  }

  public clampDistance(distance: number, maxDim: number): number {
    return Math.max(Math.max(0.5, maxDim * 0.08), Math.min(maxDim * 6, distance));
  }
}

export const cameraController = new SharedCameraController();
