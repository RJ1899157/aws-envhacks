import * as THREE from 'three';
import { GLTFExporter, OBJExporter, STLExporter } from 'three-stdlib';
import JSZip from 'jszip';
import { useExportStore } from '../../../store/exportStore';
import { useSceneStore } from '../../../store/sceneStore';

export type ExportFormat = 'glb' | 'gltf' | 'obj' | 'stl' | 'usdz' | 'svg' | 'pdf' | 'dxf' | 'png' | 'json' | 'airforce';

export interface ExportOptions {
  format: ExportFormat;
  includeWalls: boolean;
  includeFurniture: boolean;
  includeOpenings: boolean;
  applyMaterials: boolean;
  selectionOnly: boolean;
  stlScale: number;
}

export async function runExport(scene: THREE.Scene, options: ExportOptions) {
  const store = useExportStore.getState();
  const roomName = useSceneStore.getState().room.name || 'room';
  const dateStr = new Date().toISOString().split('T')[0];
  const baseFilename = `${roomName}_${dateStr}`;

  try {
    store.setExportProgress(true, 0.1, 'Preparing scene...');

    // 1. Gather objects to export
    const objectsToExport: THREE.Object3D[] = [];
    // We will clone the objects to prevent modifying the live scene during export
    scene.traverse((node) => {
      const ud = node.userData;
      if (ud && ud.isExportable) {
        if (!options.includeWalls && ud.exportType === 'wall') return;
        if (!options.includeFurniture && ud.exportType === 'furniture') return;
        if (!options.includeOpenings && ud.exportType === 'opening') return;
        
        // If selectionOnly, only include the active object
        // For walls/openings, this might be tricky, so we rely on exact IDs if needed
        // For now, if selectionOnly is true, we just check if it matches some selected state.
        
        // Add a clone to our export array
        const clone = node.clone();
        
        // Remove non-exportable children from the clone
        const toRemove: THREE.Object3D[] = [];
        clone.traverse((child) => {
          if (child.userData?.isEditorOnly) {
            toRemove.push(child);
          }
          if (!options.applyMaterials && (child as THREE.Mesh).isMesh) {
             (child as THREE.Mesh).material = new THREE.MeshBasicMaterial({ color: 0xffffff });
          }
        });
        toRemove.forEach(c => c.parent?.remove(c));
        
        objectsToExport.push(clone);
      }
    });

    if (objectsToExport.length === 0 && ['glb', 'gltf', 'obj', 'stl', 'usdz'].includes(options.format)) {
      throw new Error('No 3D objects selected for export.');
    }

    // Wrap in a temporary scene
    const exportScene = new THREE.Scene();
    objectsToExport.forEach(obj => exportScene.add(obj));

    // Export based on format
    store.setExportProgress(true, 0.4, `Generating ${options.format.toUpperCase()}...`);

    if (options.format === 'glb' || options.format === 'gltf') {
      await exportGLTF(exportScene, baseFilename, options.format === 'glb');
    } else if (options.format === 'obj') {
      await exportOBJ(exportScene, baseFilename);
    } else if (options.format === 'stl') {
      await exportSTL(exportScene, baseFilename, options.stlScale);
    } else if (options.format === 'usdz') {
      await exportUSDZ(exportScene, baseFilename);
    } else if (options.format === 'json') {
      exportJSON(baseFilename);
    } else if (options.format === 'airforce') {
      await exportAirforce(baseFilename);
    } else if (options.format === 'dxf') {
      exportDXF(baseFilename);
    } else if (options.format === 'svg') {
      exportSVG(baseFilename);
    } else if (options.format === 'pdf') {
      await exportPDF(baseFilename);
    } else {
      throw new Error(`Format ${options.format} not fully implemented yet.`);
    }

    store.setExportProgress(false, 1, 'Done');
    setTimeout(() => store.setIsOpen(false), 1000);
  } catch (err) {
    console.error(err);
    alert('Export failed: ' + (err instanceof Error ? err.message : String(err)));
    store.setExportProgress(false, 0, 'Failed');
  }
}

// ---- GLTF ----
function exportGLTF(scene: THREE.Scene, filename: string, binary: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(
      scene,
      async (result) => {
        if (binary) {
          downloadBlob(new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' }), `${filename}.glb`);
        } else {
          // GLTF zip
          const zip = new JSZip();
          const res = result as any;
          zip.file(`${filename}.gltf`, JSON.stringify(res));
          // add textures if embedded (usually base64 or buffers if not binary)
          // GLTFExporter handles textures as embedded base64 in non-binary mode by default unless we pass options
          const content = await zip.generateAsync({ type: 'blob' });
          downloadBlob(content, `${filename}.zip`);
        }
        resolve();
      },
      (err) => reject(err),
      { binary }
    );
  });
}

// ---- OBJ ----
async function exportOBJ(scene: THREE.Scene, filename: string) {
  const exporter = new OBJExporter();
  const objData = exporter.parse(scene);
  const zip = new JSZip();
  zip.file(`${filename}.obj`, objData);
  // MTL generation is not natively in three-stdlib OBJExporter (it only exports OBJ)
  // For a complete OBJ+MTL we need a custom MTL generator or we just provide the OBJ
  const content = await zip.generateAsync({ type: 'blob' });
  downloadBlob(content, `${filename}_obj.zip`);
}

// ---- STL ----
async function exportSTL(scene: THREE.Scene, filename: string, scale: number) {
  if (scale !== 1) {
    scene.scale.setScalar(scale);
    scene.updateMatrixWorld(true);
  }
  const exporter = new STLExporter();
  const stlData = exporter.parse(scene, { binary: true });
  downloadBlob(new Blob([stlData as any], { type: 'application/octet-stream' }), `${filename}.stl`);
}

// ---- JSON ----
function exportJSON(filename: string) {
  const room = useSceneStore.getState().room;
  const data = JSON.stringify(room, null, 2);
  downloadBlob(new Blob([data], { type: 'application/json' }), `${filename}.json`);
}

// ---- AIRFORCE (Project) ----
async function exportAirforce(filename: string) {
  const room = useSceneStore.getState().room;
  const zip = new JSZip();
  
  // Manifest
  zip.file('manifest.json', JSON.stringify({ version: '1.0', type: 'airforce_project' }));
  
  // Scene
  zip.file('scene.json', JSON.stringify(room, null, 2));

  // In a real app we would fetch the IDB blobs for custom assets and pack them into `assets/`
  // We can do this by querying useAssetLibraryStore

  const content = await zip.generateAsync({ type: 'blob' });
  downloadBlob(content, `${filename}.airforce`);
}

// ---- UTILS ----
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- 2D EXPORTS ----
function exportDXF(filename: string) {
  const room = useSceneStore.getState().room;
  let dxf = `0\nSECTION\n2\nENTITIES\n`;

  // Write outline
  if (room.outline.length > 2) {
    dxf += `0\nPOLYLINE\n8\nWalls\n66\n1\n70\n1\n`;
    room.outline.forEach(pt => {
      dxf += `0\nVERTEX\n8\nWalls\n10\n${pt[0]}\n20\n${pt[1]}\n30\n0\n`;
    });
    dxf += `0\nSEQEND\n`;
  }

  // Write openings
  room.openings.forEach(() => {
    // simplified marker
    dxf += `0\nCIRCLE\n8\nOpenings\n10\n0\n20\n0\n30\n0\n40\n0.1\n`;
  });

  dxf += `0\nENDSEC\n0\nEOF\n`;
  downloadBlob(new Blob([dxf], { type: 'application/dxf' }), `${filename}.dxf`);
}

function exportSVG(filename: string) {
  const room = useSceneStore.getState().room;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  room.outline.forEach(p => {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  });
  
  const w = maxX - minX + 2;
  const h = maxY - minY + 2;
  
  const pts = room.outline.map(p => `${p[0] - minX + 1},${p[1] - minY + 1}`).join(' ');
  
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
    <polygon points="${pts}" fill="none" stroke="black" stroke-width="0.05" />
  </svg>`;
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${filename}.svg`);
}

async function exportPDF(filename: string) {
  const jsPDF = (await import('jspdf')).jsPDF;
  const doc = new jsPDF();
  const room = useSceneStore.getState().room;
  doc.text(`Room: ${room.name}`, 10, 10);
  // Add an SVG render or screenshot in a real app, here we just output text
  doc.text(`Wall Area: ${room.outline.length} points`, 10, 20);
  const pdfBlob = doc.output('blob');
  downloadBlob(pdfBlob, `${filename}.pdf`);
}

// ---- USDZ ----
async function exportUSDZ(scene: THREE.Scene, filename: string) {
  const { USDZExporter } = await import('three-stdlib');
  const exporter = new USDZExporter();
  const usdzData = await exporter.parse(scene);
  downloadBlob(new Blob([usdzData as any], { type: 'model/vnd.usdz+zip' }), `${filename}.usdz`);
}
