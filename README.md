# AirForce

A modern, high-performance 3D architectural floor plan builder and asset layout tool built for the web.

## Features & Interaction Guide

### General
- **Pan / Orbit / Zoom**: Left click and drag to orbit, right click to pan, scroll to zoom. Works smoothly on trackpads (two-finger scroll) and touch devices.
- **2D / 3D Mode**: Press `Tab` or use the bottom HUD to toggle between top-down 2D orthographic view and 3D perspective view.
- **Command Palette**: Press `Cmd+K` / `Ctrl+K` to search for and execute actions.
- **Shortcuts Overlay**: Press `?` to see all keyboard shortcuts.

### Building
- **Draw Wall**: Press `W` to enter wall drawing mode. Click to place corners. Walls snap to 90/45 degree angles.
- **Edit Walls**: Drag a wall body to move it (connected walls stretch automatically). Drag a corner to adjust it. Double-click a wall to split it. Select a corner and press Delete to merge.
- **Place Objects**: Drag objects from the left Asset Library into the scene, or double-click to place them in the center.
- **Move Objects**: Drag an object. It moves freely on the XZ plane. Hold `Alt` to lift it vertically (Y-axis).
- **Rotate Objects**: Drag the rotation ring around a selected object, or press `R` to rotate by 90 degrees.
- **Openings**: Drag windows or doors onto walls. They will snap to the wall and glide along it. Drag the edges to resize them.

### Overlays & Tools
- **Outliner**: View all walls, openings, and objects in a hierarchical list. Toggle visibility (Eye) or lock them (Lock).
- **Snapshots**: Save named states of your room in the Snapshots panel (saves to IndexedDB) and restore them anytime.
- **Performance**: Press `F3` to toggle the developer FPS and draw-call overlay.

## Supported Formats

### Import
- **3D Models**: `.glb`, `.gltf` (including multi-file drops with textures), `.obj` (+ `.mtl`), `.fbx`, `.stl`, `.dae`.
- **2D Floor Plans**: `.svg`, `.dxf` (extracts outlines).
- **Projects**: `.json`, `.airforce` (native formats).

### Export
- **3D Models**: `.glb` (recommended), `.gltf` (zipped), `.obj`, `.stl`, `.usdz` (for Apple AR).
- **2D Documents**: `.svg`, `.pdf`, `.dxf`, `.png` (high-res screenshot).
- **Projects**: `.json`, `.airforce`.

## Known Limitations
- Boolean operations for openings are visually simulated using CSG-free stencils to maintain 60FPS performance; deeply complex overlapping wall corners may occasionally artifact.
- True mobile touch interactions (multi-touch gesture transforms) are a work in progress.
- Safari compatibility for USDZ export requires a recent version.
