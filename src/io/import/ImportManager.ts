import { analyzeDrop, extractFiles } from './FileLoader';
import { parse3DModel } from './formats/AssetParsers';
import { parseDxfFloorPlan, parseSvgFloorPlan } from './floorplan/Parser2D';
import { useImportStore } from '../../store/importStore';
import * as THREE from 'three';

export async function handleFileDrop(items: DataTransferItemList | FileList) {
  const store = useImportStore.getState();
  store.setProgressModal({ isOpen: true, progress: 0, message: 'Reading files...' });

  try {
    const files = await extractFiles(items);
    if (files.length === 0) throw new Error('No valid files dropped.');

    // Reject > 100MB sum
    const totalSize = files.reduce((acc, f) => acc + f.size, 0);
    if (totalSize > 100 * 1024 * 1024) {
      throw new Error('Total file size exceeds 100MB limit.');
    }

    const resolved = analyzeDrop(files);
    if (!resolved) throw new Error('Could not determine main file (glb, obj, fbx, dxf, svg, json).');

    const ext = resolved.extension;

    // Handle JSON Room
    if (ext === 'json') {
      const text = await resolved.mainFile.text();
      // Dispatch custom event that Toolbar currently listens to
      window.dispatchEvent(new CustomEvent('airforce:import-json', { detail: text }));
      store.setProgressModal({ isOpen: false });
      return;
    }

    // Handle .airforce project
    if (ext === 'airforce') {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(resolved.mainFile);
      const sceneFile = zip.file('scene.json');
      if (!sceneFile) throw new Error('Invalid .airforce project: missing scene.json');
      const text = await sceneFile.async('string');
      // For a real app, we would also extract and save embedded blobs here
      window.dispatchEvent(new CustomEvent('airforce:import-json', { detail: text }));
      store.setProgressModal({ isOpen: false });
      return;
    }

    // Handle 2D Floor Plans
    if (ext === 'dxf' || ext === 'svg') {
      store.setProgressModal({ isOpen: true, progress: 0.5, message: 'Parsing 2D floorplan...' });
      const text = await resolved.mainFile.text();
      const outline = ext === 'dxf' ? parseDxfFloorPlan(text) : parseSvgFloorPlan(text);
      if (outline.length < 3) throw new Error('Could not find a valid closed loop in ' + ext);
      
      // Calculate a rough first line length to show in scale confirmation
      const dx = outline[1]![0] - outline[0]![0];
      const dy = outline[1]![1] - outline[0]![1];
      const dist = Math.hypot(dx, dy);

      store.setProgressModal({ isOpen: false });
      store.openFloorplanDialog(outline, dist);
      return;
    }

    // Handle 3D Models
    store.setProgressModal({ isOpen: true, progress: 0.2, message: 'Loading 3D geometry...' });
    const group = await parse3DModel(resolved, (p) => {
      store.setProgressModal({ isOpen: true, progress: 0.2 + p * 0.7 });
    });

    // Detect size
    const box = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    box.getSize(size);

    store.setProgressModal({ isOpen: false });
    store.openModelDialog(resolved, group, [size.x, size.y, size.z]);

  } catch (err) {
    console.error('Import error:', err);
    alert('Import failed: ' + (err instanceof Error ? err.message : String(err)));
    store.setProgressModal({ isOpen: false });
  }
}
