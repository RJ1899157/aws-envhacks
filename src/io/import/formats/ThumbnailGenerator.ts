import * as THREE from 'three';

export function generateThumbnail(group: THREE.Group, width = 256, height = 256): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(1);

  const scene = new THREE.Scene();
  
  // Setup lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(5, 10, 7);
  scene.add(dirLight);

  // Add object
  const clone = group.clone();
  
  // Center it at origin for thumbnail
  const box = new THREE.Box3().setFromObject(clone);
  const center = new THREE.Vector3();
  box.getCenter(center);
  clone.position.sub(center);
  scene.add(clone);

  // Setup camera
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, maxDim * 10);
  camera.position.set(maxDim * 1.5, maxDim * 1.5, maxDim * 1.5);
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
  const dataUrl = canvas.toDataURL('image/png');
  
  renderer.dispose();
  return dataUrl;
}
