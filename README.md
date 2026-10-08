# AirForce

**AirForce** is an indoor air quality and ventilation simulation web application.
In this phase, we build the Blender-like 3D room builder foundation. While simulation execution will follow in a subsequent phase, the entire architecture and data model are strictly simulation-ready.

---

## Tech Stack

- **Framework**: Vite + React 18 + TypeScript (strict mode enabled)
- **3D Graphics**: Three.js via `@react-three/fiber` and `@react-three/drei`
- **State Management**: Zustand + Immer for immutable updates, Zundo for temporal undo/redo
- **Validation**: Zod for runtime schema validation and type inference
- **Styling**: Tailwind CSS
- **Testing**: Vitest for unit tests
- **Package Manager**: npm

---

## Global Conventions (Never Violate)

1. **Coordinate System & Units**:
   - Units are **METERS**.
   - **Y is UP**.
   - Floor plane is **XZ** ($Y = 0$).

2. **Room Representation**:
   - `Room = floor polygon (counter-clockwise outline, array of [x, z]) + wallHeight`.
   - Polygons are defined as 2D coordinates on the XZ floor plane in counter-clockwise order.

3. **Catalog & Asset Sizing**:
   - Every asset is defined in a catalog with real-world dimensions in meters ($[width, height, depth]$).
   - Rendered 3D models and proxy boxes are scaled to fit that bounding box.

4. **Airflow Roles**:
   - Every asset has an explicit airflow role: `"solid" | "source" | "porous" | "none"`.

5. **Openings (Windows & Doors)**:
   - Windows and doors are `"openings"` attached to a specific wall segment index.
   - Properties:
     - `wallIndex`: integer index of the wall segment ($vertex[wallIndex] \to vertex[(wallIndex + 1) \pmod N]$).
     - `offset`: distance in meters along the wall from the starting vertex.
     - `width`: opening width in meters.
     - `height`: opening height in meters.
     - `sill`: sill height from the floor in meters.
     - `role`: airflow opening role (`"inlet" | "outlet" | "closed"`).
     - `openFraction`: fractional opening degree ($0.0$ to $1.0$).

6. **Default Snapping**:
   - Translation snap: `0.05 m` ($5\text{ cm}$).
   - Rotation snap: `15°` ($15 \text{ degrees} = \frac{\pi}{12} \text{ radians}$).

7. **State Architecture**:
   - All scene state lives in **one Zustand store** (`useSceneStore`).
   - Components never hold scene data in local state.
   - Full history tracking (undo/redo) is powered by Zundo temporal middleware.

8. **Code Quality**:
   - Strict TypeScript configuration (`noImplicitAny`, `strictNullChecks`, etc.).
   - Small, modular files.
   - Fully typed component props.
   - No `any` types.
   - No dead code.

---

## Core Data & Validation Layer (`src/core`)

- **`schema.ts`**: Strict Zod schemas validating spatial coordinates, wall openings, placed objects, simulation parameters, and rooms.
  - `Vec2` ($[x, z]$ floor plane in meters) & `Vec3` ($[x, y, z]$ with $Y$ up).
  - `OpeningSchema`: Wall-attached openings with offset, width, height, sill, role (`'inlet' | 'outlet' | 'closed'`), and open fraction ($0 \dots 1$).
  - `ObjectSchema`: Placed furniture/HVAC/decor with positive bounding box sizes $[w, h, d]$, rotation, airflow role, and mounting properties.
  - `RoomSchema`: Version 1, `wallHeight` ($2.0 \dots 6.0\text{ m}$), `wallThickness` ($0.05 \dots 0.5\text{ m}$), counter-clockwise outline, openings, objects, and simulation parameters.
- **`catalog.ts`**: 16 realistic real-world items (beds, wardrobe, desk, chairs, sofa, tables, fans with $2.4\text{ m}$ elevation, purifier, window with sill $0.9\text{ m}$, door, plant) with $O(1)$ lookup via `getCatalogAsset`.
- **`units.ts`**: Mathematical helpers for snapping (with negative-zero normalization), angle conversions, clamping, and architectural imperial display formatting (`metersToFeetInches`).
- **`defaultRoom.ts`**: Factory generating a standard 4m $\times$ 3m room with 2.7m wall height, a centered window on Wall 0, and a door on Wall 2.
- **`parser.ts`**: Robust geometric validation engine (`parseRoom`) enforcing counter-clockwise winding, minimum wall lengths ($0.3\text{ m}$), area checks ($\ge 4\text{ m}^2$), simple non-self-intersecting polygons, opening boundaries, duplicate ID filtering, and cross-ventilation rules.

---

## Project Structure

```text
├── public/
│   └── models/               # 3D models and GLTF/GLB assets
├── src/
│   ├── app/                  # Application root (App, main entry, global styles)
│   ├── builder/              # 3D room builder canvas, Three.js viewport, controls
│   ├── core/                 # Simulation-ready schemas (Zod), types, and constants
│   │   ├── catalog.ts        # Item catalog definitions and dimensions
│   │   ├── constants.ts      # Snapping and dimension constants
│   │   ├── defaultRoom.ts    # Standard 4x3m default room factory
│   │   ├── parser.ts         # Room parser & geometric validation helpers
│   │   ├── schema.ts         # Zod schemas for rooms, openings, objects, and params
│   │   ├── types.ts          # Inferred TypeScript types
│   │   └── units.ts          # Numerical snapping, clamping, and unit conversions
│   ├── store/                # Single Zustand scene store with Immer & Zundo
│   └── ui/                   # UI overlays, toolbars, and controls
├── README.md
├── package.json
├── tsconfig.json             # Strict TypeScript configuration
├── vite.config.ts
├── vitest.config.ts
├── tailwind.config.js
└── postcss.config.js
```

---

## Available Scripts

- `npm run dev`: Starts the Vite development server (default port: 3000)
- `npm run build`: Type-checks with `tsc` and creates an optimized production bundle
- `npm test`: Runs Vitest unit tests in run mode
- `npm run test:watch`: Runs Vitest unit tests in interactive watch mode
- `npm run lint`: Lints all TypeScript and React files with ESLint
- `npm run format`: Formats source files with Prettier
