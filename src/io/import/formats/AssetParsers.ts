import * as THREE from 'three';
import { GLTFLoader, DRACOLoader, OBJLoader, MTLLoader, FBXLoader, STLLoader, ColladaLoader } from 'three-stdlib';
import { createBlobURLs, type ResolvedFile } from '../FileLoader';

// Singleton for Draco
let dracoLoader: DRACOLoader | null = null;
function getDracoLoader() {
  if (!dracoLoader) {
    dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  }
  return dracoLoader;
}

export async function parse3DModel(resolved: ResolvedFile, onProgress?: (p: number) => void): Promise<THREE.Group> {
  const { mainFile, fileMap, extension } = resolved;
  const { urls, revokeAll } = createBlobURLs(fileMap);

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    // If it's a blob url already, keep it
    if (url.startsWith('blob:')) return url;
    // Extract filename
    const filename = (url.split("/").pop() || "").split("?")[0]!.toLowerCase();
    if (urls[filename]) {
      return urls[filename];
    }
    return url;
  });

  const mainUrl = urls[mainFile.name.toLowerCase()] || urls[mainFile.name];
  let resultGroup = new THREE.Group();

  try {
    if (extension === 'gltf' || extension === 'glb') {
      const loader = new GLTFLoader(manager);
      loader.setDRACOLoader(getDracoLoader());
      const gltf = await loader.loadAsync(mainUrl!, (xhr: ProgressEvent) => {
        if (onProgress) onProgress(xhr.loaded / xhr.total);
      });
      resultGroup.add(gltf.scene);

    } else if (extension === 'obj') {
      // Find mtl file
      const mtlFile = Object.values(fileMap).find(f => f.name.toLowerCase().endsWith('.mtl'));
      const objLoader = new OBJLoader(manager);
      
      if (mtlFile) {
        const mtlLoader = new MTLLoader(manager);
        const mtlUrl = urls[mtlFile.name.toLowerCase()] || urls[mtlFile.name];
        const materials = await mtlLoader.loadAsync(mtlUrl!);
        materials.preload();
        objLoader.setMaterials(materials);
      }

      const obj = await objLoader.loadAsync(mainUrl!, (xhr: ProgressEvent) => {
        if (onProgress) onProgress(xhr.loaded / xhr.total);
      });
      resultGroup.add(obj);

    } else if (extension === 'fbx') {
      const loader = new FBXLoader(manager);
      const fbx = await loader.loadAsync(mainUrl!, (xhr: ProgressEvent) => {
        if (onProgress) onProgress(xhr.loaded / xhr.total);
      });
      resultGroup.add(fbx);

    } else if (extension === 'stl') {
      const loader = new STLLoader(manager);
      const geometry = await loader.loadAsync(mainUrl!, (xhr: ProgressEvent) => {
        if (onProgress) onProgress(xhr.loaded / xhr.total);
      });
      const material = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5 });
      const mesh = new THREE.Mesh(geometry, material);
      resultGroup.add(mesh);

    } else if (extension === 'dae') {
      const loader = new ColladaLoader(manager);
      const collada = await loader.loadAsync(mainUrl!, (xhr: ProgressEvent) => {
        if (onProgress) onProgress(xhr.loaded / xhr.total);
      });
      resultGroup.add(collada.scene);
    } else {
      throw new Error(`Unsupported format: ${extension}`);
    }
  } finally {
    revokeAll();
  }

  return resultGroup;
}
