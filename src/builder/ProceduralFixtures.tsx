import React from 'react';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { SOURCE_FIXTURES } from './simulation/SourceFixtures';

/**
 * Procedural bathroom and kitchen fixtures built from primitives, sized to the catalog's
 * [width, height, depth]. Pivot is bottom-centre; the back faces -Z and the front faces +Z.
 */

// Shared finishes (module singletons: reused by every instance, never disposed)
const FINISH = {
  porcelain: new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.25, metalness: 0.02 }),
  chrome: new THREE.MeshStandardMaterial({ color: '#d1d5db', roughness: 0.15, metalness: 0.95 }),
  steel: new THREE.MeshStandardMaterial({ color: '#a1a1aa', roughness: 0.35, metalness: 0.75 }),
  glass: new THREE.MeshStandardMaterial({ color: '#bae6fd', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false }),
  darkGlass: new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.15, metalness: 0.4 }),
  stone: new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.55, metalness: 0.05 }),
  water: new THREE.MeshStandardMaterial({ color: '#7dd3fc', roughness: 0.05, transparent: true, opacity: 0.7 }),
  rubber: new THREE.MeshStandardMaterial({ color: '#1f2937', roughness: 0.8 }),
  seam: new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.22 }),
};

export type FinishName = keyof typeof FINISH;

interface FixtureProps {
  size: [number, number, number];
  /** The object's own material (its catalog colour, or the ghost material while placing) */
  material: THREE.Material;
  outline: React.ReactNode;
  isGhost: boolean;
}

type Mats = Record<FinishName, THREE.Material> & { body: THREE.Material };

function useMats(material: THREE.Material, isGhost: boolean): Mats {
  // While placing, the whole fixture uses the translucent ghost material
  if (isGhost) {
    const all = {} as Mats;
    for (const key of Object.keys(FINISH) as FinishName[]) all[key] = material;
    all.body = material;
    return all;
  }
  return { ...FINISH, body: material };
}

const Box: React.FC<{
  args: [number, number, number];
  position: [number, number, number];
  mat: THREE.Material;
  radius?: number;
  children?: React.ReactNode;
}> = ({ args, position, mat, radius = 0.015, children }) => (
  <RoundedBox
    args={args}
    position={position}
    radius={Math.min(radius, Math.min(...args) / 2 - 1e-4)}
    smoothness={3}
    material={mat}
    castShadow
    receiveShadow
  >
    {children}
  </RoundedBox>
);

/** Thin dark line drawn on a front face (door gaps, panel joins) */
const Seam: React.FC<{ position: [number, number, number]; size: [number, number] }> = ({ position, size }) => (
  <mesh position={position} raycast={() => null}>
    <planeGeometry args={size} />
    <primitive object={FINISH.seam} attach="material" />
  </mesh>
);

const Handle: React.FC<{ position: [number, number, number]; length: number; vertical?: boolean; mat: THREE.Material }> = ({
  position,
  length,
  vertical = false,
  mat,
}) => (
  <mesh position={position} rotation={vertical ? [0, 0, 0] : [0, 0, Math.PI / 2]} material={mat} castShadow>
    <cylinderGeometry args={[0.008, 0.008, length, 10]} />
  </mesh>
);

/** A run of base cabinets with door gaps and handles across the front */
const CabinetFront: React.FC<{ width: number; height: number; z: number; y: number; mat: THREE.Material; doorWidth?: number }> = ({
  width,
  height,
  z,
  y,
  mat,
  doorWidth = 0.6,
}) => {
  const doors = Math.max(1, Math.round(width / doorWidth));
  const w = width / doors;
  return (
    <>
      {Array.from({ length: doors - 1 }, (_, i) => (
        <Seam key={`s${i}`} position={[-width / 2 + w * (i + 1), y, z]} size={[0.006, height * 0.94]} />
      ))}
      {Array.from({ length: doors }, (_, i) => (
        <Handle key={`h${i}`} position={[-width / 2 + w * i + w * 0.8, y + height * 0.32, z + 0.012]} length={0.12} vertical mat={mat} />
      ))}
    </>
  );
};

// ---------------------------------------------------------------------------
// Bathroom
// ---------------------------------------------------------------------------

const Toilet: React.FC<FixtureProps> = ({ size: [W, H, D], material, outline, isGhost }) => {
  const m = useMats(material, isGhost);
  const seatY = Math.min(0.42, H * 0.52);
  const bowlR = W * 0.46;
  const bowlZ = D * 0.12;
  return (
    <group>
      {/* Pedestal and bowl, elliptical */}
      <group position={[0, 0, bowlZ]} scale={[1, 1, 1.3]}>
        <mesh position={[0, seatY * 0.35, 0]} material={m.porcelain} castShadow receiveShadow>
          <cylinderGeometry args={[bowlR * 0.6, bowlR * 0.7, seatY * 0.7, 28]} />
          {outline}
        </mesh>
        <mesh position={[0, seatY * 0.82, 0]} material={m.porcelain} castShadow>
          <cylinderGeometry args={[bowlR, bowlR * 0.65, seatY * 0.36, 28]} />
        </mesh>
        {/* Water and seat ring */}
        <mesh position={[0, seatY * 0.9, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.water}>
          <circleGeometry args={[bowlR * 0.62, 24]} />
        </mesh>
        <mesh position={[0, seatY + 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.porcelain} castShadow>
          <torusGeometry args={[bowlR * 0.78, bowlR * 0.2, 10, 28]} />
        </mesh>
      </group>
      {/* Cistern against the wall, with lid and flush button */}
      <Box args={[W * 0.95, H - seatY + 0.02, D * 0.24]} position={[0, seatY + (H - seatY) / 2 - 0.01, -D / 2 + D * 0.12]} mat={m.porcelain} radius={0.03}>
        {outline}
      </Box>
      <Box args={[W, 0.03, D * 0.27]} position={[0, H - 0.015, -D / 2 + D * 0.12]} mat={m.porcelain} />
      <mesh position={[0, H + 0.006, -D / 2 + D * 0.12]} material={m.chrome}>
        <cylinderGeometry args={[0.025, 0.025, 0.012, 16]} />
      </mesh>
    </group>
  );
};

const SinkVanity: React.FC<FixtureProps> = ({ size: [W, H, D], material, outline, isGhost }) => {
  const m = useMats(material, isGhost);
  const topH = 0.04;
  const bodyH = H - topH;
  const basinR = Math.min(W, D) * 0.32;
  return (
    <group>
      <Box args={[W, bodyH, D * 0.96]} position={[0, bodyH / 2, -D * 0.02]} mat={m.body}>
        {outline}
      </Box>
      <CabinetFront width={W} height={bodyH} y={bodyH / 2} z={D / 2 - D * 0.04 + 0.001} mat={m.chrome} doorWidth={W / 2} />
      {/* Countertop with a vessel basin and faucet */}
      <Box args={[W + 0.02, topH, D]} position={[0, bodyH + topH / 2, 0]} mat={m.porcelain} radius={0.01} />
      <mesh position={[0, H + 0.06, D * 0.06]} material={m.porcelain} castShadow>
        <cylinderGeometry args={[basinR, basinR * 0.7, 0.12, 28]} />
      </mesh>
      <mesh position={[0, H + 0.115, D * 0.06]} rotation={[-Math.PI / 2, 0, 0]} material={m.water}>
        <circleGeometry args={[basinR * 0.86, 24]} />
      </mesh>
      <mesh position={[0, H + 0.12, -D / 2 + 0.08]} material={m.chrome} castShadow>
        <cylinderGeometry args={[0.014, 0.018, 0.24, 12]} />
      </mesh>
      <mesh position={[0, H + 0.23, -D / 2 + 0.13]} rotation={[Math.PI / 2, 0, 0]} material={m.chrome}>
        <cylinderGeometry args={[0.012, 0.012, 0.11, 12]} />
      </mesh>
    </group>
  );
};

const Bathtub: React.FC<FixtureProps> = ({ size: [W, H, D], material, outline, isGhost }) => {
  const m = useMats(material, isGhost);
  const t = 0.07; // rim thickness
  return (
    <group>
      {/* Floor of the tub, then four rounded walls forming the rim */}
      <Box args={[W, H * 0.35, D]} position={[0, H * 0.175, 0]} mat={m.porcelain} radius={0.04}>
        {outline}
      </Box>
      <Box args={[W, H, t]} position={[0, H / 2, -D / 2 + t / 2]} mat={m.porcelain} radius={0.03} />
      <Box args={[W, H, t]} position={[0, H / 2, D / 2 - t / 2]} mat={m.porcelain} radius={0.03} />
      <Box args={[t, H, D]} position={[-W / 2 + t / 2, H / 2, 0]} mat={m.porcelain} radius={0.03} />
      <Box args={[t, H, D]} position={[W / 2 - t / 2, H / 2, 0]} mat={m.porcelain} radius={0.03} />
      <mesh position={[0, H * 0.62, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.water}>
        <planeGeometry args={[W - 2 * t, D - 2 * t]} />
      </mesh>
      {/* Mixer tap on the end */}
      <mesh position={[-W / 2 + t / 2, H + 0.08, 0]} material={m.chrome} castShadow>
        <cylinderGeometry args={[0.015, 0.02, 0.16, 12]} />
      </mesh>
      <mesh position={[-W / 2 + t + 0.05, H + 0.15, 0]} rotation={[0, 0, Math.PI / 2]} material={m.chrome}>
        <cylinderGeometry args={[0.013, 0.013, 0.12, 12]} />
      </mesh>
    </group>
  );
};

const ShowerCabin: React.FC<FixtureProps> = ({ size: [W, H, D], material, outline, isGhost }) => {
  const m = useMats(material, isGhost);
  const trayH = 0.08;
  const panelH = H - trayH;
  const post = 0.022;
  const corners: [number, number][] = [
    [-W / 2, -D / 2],
    [W / 2, -D / 2],
    [-W / 2, D / 2],
    [W / 2, D / 2],
  ];
  return (
    <group>
      <Box args={[W, trayH, D]} position={[0, trayH / 2, 0]} mat={m.porcelain} radius={0.02}>
        {outline}
      </Box>
      <mesh position={[0, trayH + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.steel}>
        <circleGeometry args={[0.04, 16]} />
      </mesh>
      {/* Glass on the two sides and the front (the back is the wall) */}
      <mesh position={[-W / 2, trayH + panelH / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={m.glass}>
        <planeGeometry args={[D, panelH]} />
      </mesh>
      <mesh position={[W / 2, trayH + panelH / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={m.glass}>
        <planeGeometry args={[D, panelH]} />
      </mesh>
      <mesh position={[0, trayH + panelH / 2, D / 2]} material={m.glass}>
        <planeGeometry args={[W, panelH]} />
      </mesh>
      {/* Chrome frame */}
      {corners.map(([x, z], i) => (
        <mesh key={i} position={[x, trayH + panelH / 2, z]} material={m.chrome}>
          <boxGeometry args={[post, panelH, post]} />
        </mesh>
      ))}
      <mesh position={[0, H, D / 2]} material={m.chrome}>
        <boxGeometry args={[W, post, post]} />
      </mesh>
      <mesh position={[-W / 2, H, 0]} material={m.chrome}>
        <boxGeometry args={[post, post, D]} />
      </mesh>
      <mesh position={[W / 2, H, 0]} material={m.chrome}>
        <boxGeometry args={[post, post, D]} />
      </mesh>
      <Handle position={[W * 0.3, trayH + panelH * 0.5, D / 2 + 0.02]} length={0.3} vertical mat={m.chrome} />
      {/* Riser and rain head on the back wall */}
      <mesh position={[0, trayH + panelH * 0.55, -D / 2 + 0.03]} material={m.chrome}>
        <cylinderGeometry args={[0.012, 0.012, panelH * 0.75, 10]} />
      </mesh>
      <mesh position={[0, H - 0.12, -D / 2 + 0.16]} material={m.chrome}>
        <cylinderGeometry args={[0.11, 0.11, 0.015, 24]} />
      </mesh>
    </group>
  );
};

const WashingMachine: React.FC<FixtureProps> = ({ size: [W, H, D], material, outline, isGhost }) => {
  const m = useMats(material, isGhost);
  const doorR = Math.min(W, H) * 0.3;
  return (
    <group>
      <Box args={[W, H, D]} position={[0, H / 2, 0]} mat={m.body} radius={0.025}>
        {outline}
      </Box>
      {/* Control strip, drawer and dial */}
      <Seam position={[0, H - 0.14, D / 2 + 0.001]} size={[W * 0.96, 0.006]} />
      <Seam position={[-W * 0.22, H - 0.07, D / 2 + 0.001]} size={[W * 0.4, 0.07]} />
      <mesh position={[W * 0.28, H - 0.07, D / 2 + 0.008]} rotation={[Math.PI / 2, 0, 0]} material={m.chrome}>
        <cylinderGeometry args={[0.03, 0.03, 0.016, 20]} />
      </mesh>
      {/* Porthole door */}
      <mesh position={[0, H * 0.45, D / 2 + 0.012]} material={m.chrome} castShadow>
        <torusGeometry args={[doorR, 0.025, 12, 32]} />
      </mesh>
      <mesh position={[0, H * 0.45, D / 2 + 0.006]} material={m.darkGlass}>
        <circleGeometry args={[doorR, 32]} />
      </mesh>
    </group>
  );
};

const TallCabinet: React.FC<FixtureProps> = ({ size: [W, H, D], material, outline, isGhost }) => {
  const m = useMats(material, isGhost);
  const doors = W > 0.9 ? 2 : 1;
  return (
    <group>
      <Box args={[W, H, D]} position={[0, H / 2, 0]} mat={m.body} radius={0.012}>
        {outline}
      </Box>
      {doors === 2 && <Seam position={[0, H / 2, D / 2 + 0.001]} size={[0.006, H * 0.96]} />}
      {doors === 2 ? (
        <>
          <Handle position={[-0.05, H * 0.5, D / 2 + 0.015]} length={0.2} vertical mat={m.chrome} />
          <Handle position={[0.05, H * 0.5, D / 2 + 0.015]} length={0.2} vertical mat={m.chrome} />
        </>
      ) : (
        <Handle position={[W / 2 - 0.06, H * 0.5, D / 2 + 0.015]} length={0.2} vertical mat={m.chrome} />
      )}
      <Seam position={[0, H * 0.04, D / 2 + 0.001]} size={[W * 0.96, 0.006]} />
    </group>
  );
};

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------

const KitchenCounter: React.FC<FixtureProps & { sink?: boolean; island?: boolean }> = ({
  size: [W, H, D],
  material,
  outline,
  isGhost,
  sink = false,
  island = false,
}) => {
  const m = useMats(material, isGhost);
  const topH = 0.04;
  const kick = 0.08;
  const bodyH = H - topH - kick;
  const overhang = island ? 0.25 : 0.02;
  const bodyD = D - overhang;
  return (
    <group>
      {/* Recessed plinth, cabinets, worktop */}
      <Box args={[W - 0.04, kick, bodyD - 0.06]} position={[0, kick / 2, -overhang / 2 - 0.03]} mat={m.rubber} radius={0.005} />
      <Box args={[W, bodyH, bodyD]} position={[0, kick + bodyH / 2, -overhang / 2]} mat={m.body} radius={0.01}>
        {outline}
      </Box>
      <CabinetFront width={W} height={bodyH} y={kick + bodyH / 2} z={-overhang / 2 + bodyD / 2 + 0.001} mat={m.chrome} />
      <Box args={[W + 0.02, topH, D]} position={[0, H - topH / 2, 0]} mat={m.stone} radius={0.008} />
      {sink && (
        <>
          <mesh position={[0, H + 0.001, 0.02]} rotation={[-Math.PI / 2, 0, 0]} material={m.steel}>
            <planeGeometry args={[Math.min(W * 0.55, 0.8), D * 0.6]} />
          </mesh>
          <mesh position={[0, H + 0.002, 0.02]} rotation={[-Math.PI / 2, 0, 0]} material={m.darkGlass}>
            <circleGeometry args={[0.025, 16]} />
          </mesh>
          {/* Gooseneck tap */}
          <mesh position={[0, H + 0.16, -D / 2 + 0.07]} material={m.chrome} castShadow>
            <cylinderGeometry args={[0.014, 0.018, 0.32, 12]} />
          </mesh>
          <mesh position={[0, H + 0.32, -D / 2 + 0.14]} rotation={[0, Math.PI / 2, 0]} material={m.chrome}>
            <torusGeometry args={[0.07, 0.012, 8, 16, Math.PI]} />
          </mesh>
        </>
      )}
    </group>
  );
};

const Oven: React.FC<FixtureProps> = ({ size: [W, H, D], material, outline, isGhost }) => {
  const m = useMats(material, isGhost);
  const burnerR = Math.min(W, D) * 0.12;
  const burners: [number, number][] = [
    [-W * 0.22, -D * 0.18],
    [W * 0.22, -D * 0.18],
    [-W * 0.22, D * 0.16],
    [W * 0.22, D * 0.16],
  ];
  return (
    <group>
      <Box args={[W, H, D]} position={[0, H / 2, 0]} mat={m.body} radius={0.012}>
        {outline}
      </Box>
      {/* Hob */}
      <mesh position={[0, H + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.darkGlass}>
        <planeGeometry args={[W * 0.94, D * 0.9]} />
      </mesh>
      {burners.map(([x, z], i) => (
        <mesh key={i} position={[x, H + 0.006, z]} rotation={[-Math.PI / 2, 0, 0]} material={m.steel}>
          <torusGeometry args={[burnerR, 0.008, 6, 24]} />
        </mesh>
      ))}
      {/* Knobs, oven door window and handle */}
      {[-0.3, -0.1, 0.1, 0.3].map((f) => (
        <mesh key={f} position={[W * f, H - 0.06, D / 2 + 0.012]} rotation={[Math.PI / 2, 0, 0]} material={m.chrome}>
          <cylinderGeometry args={[0.02, 0.02, 0.022, 14]} />
        </mesh>
      ))}
      <mesh position={[0, H * 0.45, D / 2 + 0.002]} material={m.darkGlass}>
        <planeGeometry args={[W * 0.8, H * 0.45]} />
      </mesh>
      <Handle position={[0, H * 0.74, D / 2 + 0.03]} length={W * 0.7} mat={m.chrome} />
    </group>
  );
};

const Dishwasher: React.FC<FixtureProps> = ({ size: [W, H, D], material, outline, isGhost }) => {
  const m = useMats(material, isGhost);
  return (
    <group>
      <Box args={[W, H, D]} position={[0, H / 2, 0]} mat={m.body} radius={0.012}>
        {outline}
      </Box>
      <Seam position={[0, H - 0.1, D / 2 + 0.001]} size={[W * 0.96, 0.006]} />
      <Handle position={[0, H - 0.05, D / 2 + 0.02]} length={W * 0.6} mat={m.chrome} />
    </group>
  );
};

const Fridge: React.FC<FixtureProps> = ({ size: [W, H, D], material, outline, isGhost }) => {
  const m = useMats(material, isGhost);
  const split = H * 0.66;
  return (
    <group>
      <Box args={[W, H, D]} position={[0, H / 2, 0]} mat={m.body} radius={0.03}>
        {outline}
      </Box>
      {/* Freezer below, fridge above; side-by-side doors when wide */}
      <Seam position={[0, split, D / 2 + 0.001]} size={[W * 0.96, 0.008]} />
      {W > 0.8 && <Seam position={[0, H / 2, D / 2 + 0.001]} size={[0.008, H * 0.96]} />}
      <Handle position={[W > 0.8 ? -0.05 : W / 2 - 0.06, split + (H - split) / 2, D / 2 + 0.02]} length={0.3} vertical mat={m.chrome} />
      <Handle position={[W > 0.8 ? 0.05 : W / 2 - 0.06, split * 0.75, D / 2 + 0.02]} length={0.3} vertical mat={m.chrome} />
    </group>
  );
};

const RangeHood: React.FC<FixtureProps> = ({ size: [W, H, D], material, outline, isGhost }) => {
  const m = useMats(material, isGhost);
  const canopyH = H * 0.3;
  return (
    <group>
      {/* Canopy over the hob, tapering into the chimney */}
      <Box args={[W, canopyH, D]} position={[0, canopyH / 2, 0]} mat={m.steel} radius={0.01}>
        {outline}
      </Box>
      <mesh position={[0, canopyH + 0.06, -D * 0.1]} material={m.steel} castShadow>
        <boxGeometry args={[W * 0.55, 0.12, D * 0.7]} />
      </mesh>
      <mesh position={[0, canopyH + 0.12 + (H - canopyH - 0.12) / 2, -D / 2 + D * 0.2]} material={m.steel} castShadow>
        <boxGeometry args={[W * 0.32, H - canopyH - 0.12, D * 0.4]} />
      </mesh>
      {/* Filter grille underneath */}
      <mesh position={[0, -0.001, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.darkGlass}>
        <planeGeometry args={[W * 0.8, D * 0.7]} />
      </mesh>
    </group>
  );
};

const FIXTURES: Record<string, React.FC<FixtureProps>> = {
  toilet: Toilet,
  'sink-vanity': SinkVanity,
  bathtub: Bathtub,
  'shower-cabin': ShowerCabin,
  'washing-machine': WashingMachine,
  'towel-cabinet': TallCabinet,
  'kitchen-counter': KitchenCounter,
  'kitchen-sink': (props) => <KitchenCounter {...props} sink />,
  'kitchen-island': (props) => <KitchenCounter {...props} island />,
  oven: Oven,
  dishwasher: Dishwasher,
  fridge: Fridge,
  'range-hood': RangeHood,
  ...SOURCE_FIXTURES,
};

/** The procedural fixture for a catalog id, or null when it has no dedicated model */
export function getFixture(assetId: string): React.FC<FixtureProps> | null {
  return FIXTURES[assetId] ?? null;
}
