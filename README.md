# AirForce Studio

**AirForce Studio** is a high-performance, web-based 3D architectural and indoor air quality (IAQ) ventilation modeler built with **React 18**, **Three.js / React Three Fiber (R3F)**, **Zustand**, and **TypeScript**.

AirForce combines Blender-grade CAD tools (arbitrary polygon drafting, vertex manipulation, real-scale catalog placement, physical collision detection, wall-opening tagging) with CFD domain discretization (regular 3D voxelization) to produce simulation-ready room specifications.

---

## Quickstart & Setup

### Prerequisites
- Node.js 18+ (Node 20+ recommended)
- npm 9+

### Installation & Execution
```bash
# Install dependencies
npm install

# Start development server (port 3000)
npm run dev

# Run comprehensive test suite (Vitest)
npm test

# Run linter
npm run lint

# Format codebase (Prettier)
npm run format

# Production build (TypeScript compilation + Vite bundle)
npm run build
```

---

## Architectural & Engineering Conventions

1. **Coordinate System & Units**:
   - Standard SI units: **Meters** throughout.
   - **Y is UP** ($Y = 0$ is the floor plane).
   - Horizontal floor plane is **XZ**.
2. **Room Representation**:
   - `Room = floor polygon (counter-clockwise outline, array of [x, z]) + wallHeight + wallThickness`.
   - Polygons are strictly counter-clockwise (CCW) on the XZ floor plane, yielding positive signed area via the Shoelace theorem.
3. **Openings (Windows & Doors)**:
   - Attached to a specific wall segment index ($vertex[i] \to vertex[i+1]$).
   - Parameterized by `offset` along wall tangent, `width`, `height`, `sill` height, `role` (`inlet` | `outlet` | `closed`), and `openFraction` ($0.0 \dots 1.0$).
   - Walls render with CSG-free rectangular sub-box extrusion around opening cutouts.
4. **Asset Sizing & Roles**:
   - Every asset is defined with realistic bounding box dimensions $[width, height, depth]$ in meters.
   - Airflow roles: `"solid" | "source" | "porous" | "none"`.
5. **Collision Detection**:
   - 2D Separating Axis Theorem (SAT) for rotated object footprints on XZ.
   - 1D vertical overlap tests along Y with elevation.
   - Room polygon boundary containment checks prevent objects from protruding through walls.
6. **State & History Management**:
   - Single source of truth via Zustand (`useSceneStore` with Immer middleware).
   - Full temporal undo/redo history (up to 100 steps) managed via Zundo with drag coalescing.
   - Local state is strictly forbidden for room geometry data.
   - Autosave debounces scene state to `localStorage` every 500 ms with restore prompt.

---

## Blender-Inspired Keyboard Shortcuts

| Shortcut | Context | Action |
| :--- | :--- | :--- |
| **G** | Selection | Activate Move / Translation mode |
| **R** | Selection | Activate Rotate mode (restricted to Y-axis) |
| **Shift + D** | Selection | Duplicate selected object (offset 0.3 m) |
| **Delete** / **X** | Selection | Delete selected object or vertex |
| **Ctrl + Z** / **Cmd + Z** | Global | Undo last modification |
| **Ctrl + Shift + Z** | Global | Redo last undone modification |
| **Ctrl + A** / **Cmd + A** | Global | Select all objects in the room |
| **Esc** | Global | Clear selection or cancel active tool |
| **Tab** / **Numpad 5** | Viewport | Toggle between 3D Perspective and 2D Top-Down |
| **Numpad 7** | Viewport | Top view camera angle |
| **Numpad 1** | Viewport | Front view camera angle |
| **Numpad 3** | Viewport | Right view camera angle |
| **Home** / **F** | Viewport | Frame camera to room boundary / selected object |
| **Shift (Hold)** | Placement | Repeat placement of selected catalog item |
| **Shift (Hold)** | Draw Floor | Lock cursor to orthogonal horizontal/vertical axes |
| **Enter** | Draw Floor | Close and complete polygon floor outline |
| **Numeric + Enter** | Transform / Draw | Precise numeric input (e.g. `0.5` + Enter to move 0.5m) |
| **Right-Drag** | Viewport | Orbit camera (damping enabled, clamped above floor) |
| **Middle-Drag** | Viewport | Pan camera |
| **Scroll Wheel** | Viewport | Zoom in / out |

---

## Core Data Model

```typescript
// Spatial Vectors
type Vec2 = [x: number, z: number]; // Floor plane coordinates in meters
type Vec3 = [x: number, y: number, z: number]; // 3D coordinates (Y up)

// Wall Openings
interface Opening {
  id: string;
  wallIndex: number;
  type: 'window' | 'door';
  offset: number;     // Distance along wall in meters
  width: number;      // Opening width in meters
  height: number;     // Opening height in meters
  sill: number;       // Sill height from floor in meters
  role: 'inlet' | 'outlet' | 'closed';
  openFraction: number; // 0.0 (closed) to 1.0 (fully open)
}

// 3D Placed Objects
interface SceneObject {
  id: string;
  assetId: string;
  name: string;
  position: Vec3;     // [x, y, z] in meters
  rotation: Vec3;     // Euler angles in radians [0, rotY, 0]
  size: Vec3;         // [width, height, depth] in meters
  scale?: Vec3;       // Multipliers [sx, sy, sz]
  elevation: number;  // Offset from floor in meters
  role: 'solid' | 'source' | 'porous' | 'none';
  wallMounted: boolean;
  color?: string;
  defaultAirflow?: number; // m³/h or m/s
}

// Environmental Simulation Parameters
interface RoomParams {
  windSpeed: number;    // m/s (>= 0)
  windDirDeg: number;   // 0-360° (0° = North, 90° = East)
  pressurePa: number;   // Atmospheric pressure in Pa
  indoorTempC: number;  // °C
  outdoorTempC: number; // °C
  humidity: number;     // 0-100%
  datetime: string;     // ISO 8601 string
  pollutantSource?: {
    type: string;
    emissionRateMgH: number; // mg/hour
    position?: Vec3;
  };
}

// Room Specification
interface Room {
  version: 1;
  name: string;
  wallHeight: number;    // 2.0 to 6.0 m (default: 2.7m)
  wallThickness: number; // 0.05 to 0.5 m (default: 0.15m)
  outline: Vec2[];       // Minimum 3 vertices, CCW order
  openings: Opening[];
  objects: SceneObject[];
  params: RoomParams;
}

// Discretized Simulation Domain
interface VoxelGrid {
  nx: number;
  ny: number;
  nz: number;
  dx: number;            // Cell pitch in meters (default: 0.1m)
  origin: [number, number, number];
  cells: Uint8Array;     // Flat index: i + j*nx + k*nx*ny
  idx: (i: number, j: number, k: number) => number;
}
```

---

## 3D Voxel Discretization Engine

The `voxelize(room, dx = 0.1)` engine prepares the geometric domain for computational fluid dynamics (CFD) and indoor air quality (IAQ) calculations:

- **FLUID (`0`)**: Interior room volume within the polygon boundary and $0 \le y < \text{wallHeight}$.
- **SOLID (`1`)**: Exterior margin, exterior wall thickness, and solid furniture (wardrobes, desks, beds).
- **INLET (`2`)**: Cells punched through the wall thickness corresponding to inlet windows/openings.
- **OUTLET (`3`)**: Cells punched through the wall thickness corresponding to outlet doors/openings.
- **SOURCE (`4`)**: IAQ pollutant emission points and fan airflow sources.
- **POROUS (`5`)**: Permeable boundaries (curtains, screens, porous partitions).

### Performance Features
- Object cell filling is strictly confined to each object's 3D axis-aligned bounding box (AABB), supporting arbitrary Euler Y rotations and elevations.
- 2D polygon membership is precomputed per vertical column ($O(nx \cdot nz)$), rendering full 3D domain voxelization in under 2 milliseconds for typical room sizes.
- Automatic offloading to a Web Worker (`src/core/voxelWorker.ts`) with zero-copy `ArrayBuffer` transfer if domain voxelization exceeds 50 ms.
- Interactive 3D visualizer (`VoxelDebug.tsx`) using `THREE.InstancedMesh` with real-time Y-slice isolation, opacity slider, and HUD memory tracking.

---

## Folder Structure

```text
airforce/
├── public/
│   └── models/               # 3D GLTF/GLB models
├── src/
│   ├── app/
│   │   ├── App.tsx           # Top-level application layout
│   │   ├── index.css         # Tailwind & global stylesheet
│   │   └── main.tsx          # DOM entry point
│   ├── builder/
│   │   ├── AssetMesh.tsx     # 3D object instance (GLTF + procedural rounded box)
│   │   ├── Canvas.tsx        # Viewport with OrbitControls, axes, and gizmo
│   │   ├── CanvasErrorBoundary.tsx # WebGL context error recovery boundary
│   │   ├── FloorPlanEditor.tsx # Interactive polygon drafting & handle editing
│   │   ├── OpeningTaggingPanel.tsx # Floating 3D opening tag panel
│   │   ├── PlacedObjects.tsx # Memoized object collection renderer
│   │   ├── PlacementController.tsx # Ghost placement & raycasting controller
│   │   ├── RoomShell.tsx     # Wall extrusion with CSG-free opening cutouts
│   │   ├── screenshot.ts     # Crisp PNG canvas screenshot exporter
│   │   ├── SelectionGizmo.tsx # TransformControls gizmo & collision feedback
│   │   ├── ViewportCanvas.tsx# Viewport camera synchronizer
│   │   └── VoxelDebug.tsx    # 3D InstancedMesh voxel grid visualizer
│   ├── core/
│   │   ├── catalog.ts        # 16 real-scale catalog items & definitions
│   │   ├── collision.ts      # SAT 2D/3D physical collision detector
│   │   ├── constants.ts      # Snapping and architectural constants
│   │   ├── defaultRoom.ts    # Default room factory (4x3m)
│   │   ├── migration.ts      # Schema versioning & legacy payload migrator
│   │   ├── parser.ts         # Polygon validation & signed area engine
│   │   ├── sampleRoom.ts     # Sample room factories
│   │   ├── samples/          # Preconfigured studio, bedroom, living room
│   │   ├── schema.ts         # Zod schemas for rooms, objects, and params
│   │   ├── types.ts          # Inferred TypeScript definitions
│   │   ├── units.ts          # Snapping, angle conversions, and formatting
│   │   ├── voxelizer.ts      # 3D voxel grid generation engine
│   │   └── voxelWorker.ts    # Dedicated Web Worker for background voxelization
│   ├── store/
│   │   ├── sceneStore.ts     # Central room state (Zustand + Immer + Zundo)
│   │   ├── uiStore.ts        # UI state (tools, transforms, views, snapping)
│   │   └── useAutosave.ts    # Debounced localStorage autosave & restore
│   └── ui/
│       ├── AssetLibrary.tsx  # Categorized asset sidebar with search
│       ├── HeaderOverlay.tsx # Top branding overlay
│       ├── HudOverlay.tsx    # Live coordinate, tool, snap, and voxel HUD
│       ├── ImportIssuesModal.tsx # Validation error dialog
│       ├── Inspector.tsx     # Contextual object & simulation params sidebar
│       ├── OnboardingModal.tsx # 4-step interactive first-run tutorial
│       ├── RestoreSessionModal.tsx # Session restoration prompt
│       └── Toolbar.tsx       # Top tool controls, view toggles, and actions
├── README.md
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

---

## License

Private / Confidential. Built for AirForce IAQ simulation.
