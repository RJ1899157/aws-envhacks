import React from 'react';
import * as THREE from 'three';

/**
 * Procedural markers for placeable PM2.5 sources, sized to the catalog's [width, height, depth]
 * with the pivot at the bottom centre. They are deliberately icon-like: small, high contrast and
 * readable from above, since the source matters more than the object.
 */

interface FixtureProps {
  size: [number, number, number];
  material: THREE.Material;
  outline: React.ReactNode;
  isGhost: boolean;
}

const M = {
  iron: new THREE.MeshStandardMaterial({ color: '#27272a', roughness: 0.6, metalness: 0.6 }),
  steel: new THREE.MeshStandardMaterial({ color: '#a1a1aa', roughness: 0.3, metalness: 0.85 }),
  clay: new THREE.MeshStandardMaterial({ color: '#b45309', roughness: 0.85 }),
  paper: new THREE.MeshStandardMaterial({ color: '#f5f5f4', roughness: 0.7 }),
  roti: new THREE.MeshStandardMaterial({ color: '#e7c27d', roughness: 0.9 }),
  wood: new THREE.MeshStandardMaterial({ color: '#92400e', roughness: 0.8 }),
  straw: new THREE.MeshStandardMaterial({ color: '#d6a43a', roughness: 0.9 }),
  coil: new THREE.MeshStandardMaterial({ color: '#166534', roughness: 0.8 }),
  flameBlue: new THREE.MeshBasicMaterial({ color: '#60a5fa', toneMapped: false }),
  flame: new THREE.MeshBasicMaterial({ color: '#fbbf24', toneMapped: false }),
  ember: new THREE.MeshBasicMaterial({ color: '#f97316', toneMapped: false }),
  glow: new THREE.MeshBasicMaterial({ color: '#ef4444', toneMapped: false }),
};

type Mats = Record<keyof typeof M, THREE.Material> & { body: THREE.Material };

function mats(material: THREE.Material, isGhost: boolean): Mats {
  const all = { ...M, body: material } as Mats;
  if (isGhost) for (const k of Object.keys(all) as (keyof Mats)[]) all[k] = material;
  return all;
}

/** Gas burner with a frying pan (frying) or a pot (boiling). */
const Stove: React.FC<FixtureProps & { pot?: boolean }> = ({ size, material, isGhost, pot }) => {
  const [W, H] = size;
  const m = mats(material, isGhost);
  const r = W * 0.42;
  return (
    <group>
      <mesh position={[0, 0.01, 0]} material={m.iron}>
        <cylinderGeometry args={[W * 0.48, W * 0.5, 0.02, 24]} />
      </mesh>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <mesh key={i} position={[Math.cos((i * Math.PI) / 4) * r * 0.55, 0.03, Math.sin((i * Math.PI) / 4) * r * 0.55]} material={m.flameBlue}>
          <coneGeometry args={[0.012, 0.035, 6]} />
        </mesh>
      ))}
      {pot ? (
        <mesh position={[0, 0.03 + (H - 0.03) / 2, 0]} material={m.steel}>
          <cylinderGeometry args={[r * 0.8, r * 0.72, H - 0.03, 24]} />
        </mesh>
      ) : (
        <group position={[0, 0.05, 0]}>
          <mesh material={m.body}>
            <cylinderGeometry args={[r, r * 0.85, Math.max(0.02, H - 0.06), 28]} />
          </mesh>
          <mesh position={[r * 1.6, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={m.iron}>
            <cylinderGeometry args={[0.012, 0.012, r * 1.4, 8]} />
          </mesh>
        </group>
      )}
    </group>
  );
};

/** Flat iron tawa with a roti on it. */
const Tawa: React.FC<FixtureProps> = ({ size, material, isGhost }) => {
  const [W, H] = size;
  const m = mats(material, isGhost);
  return (
    <group>
      <mesh position={[0, H * 0.35, 0]} material={m.body}>
        <cylinderGeometry args={[W / 2, W * 0.46, H * 0.3, 32]} />
      </mesh>
      <mesh position={[0, H * 0.6, 0]} material={m.roti}>
        <cylinderGeometry args={[W * 0.33, W * 0.33, H * 0.15, 28]} />
      </mesh>
      <mesh position={[0, H * 0.1, 0]} material={m.flameBlue}>
        <torusGeometry args={[W * 0.2, 0.008, 6, 20]} />
      </mesh>
    </group>
  );
};

/** Incense stand with a stick and a glowing tip. */
const Incense: React.FC<FixtureProps> = ({ size, material, isGhost }) => {
  const [W, H] = size;
  const m = mats(material, isGhost);
  return (
    <group>
      <mesh position={[0, 0.015, 0]} material={m.body}>
        <cylinderGeometry args={[W / 2, W / 2, 0.03, 16]} />
      </mesh>
      <mesh position={[0, H / 2, 0]} rotation={[0, 0, 0.12]} material={m.wood}>
        <cylinderGeometry args={[0.005, 0.005, H - 0.02, 6]} />
      </mesh>
      <mesh position={[-Math.sin(0.12) * (H / 2 - 0.01), H - 0.01, 0]} material={m.ember}>
        <sphereGeometry args={[0.011, 8, 8]} />
      </mesh>
    </group>
  );
};

/** Green spiral coil on a small stand. */
const Coil: React.FC<FixtureProps> = ({ size, material, isGhost }) => {
  const [W, H] = size;
  const m = mats(material, isGhost);
  const turns = [0.46, 0.34, 0.22, 0.1];
  return (
    <group position={[0, H * 0.6, 0]}>
      {turns.map((f) => (
        <mesh key={f} rotation={[Math.PI / 2, 0, 0]} material={m.coil}>
          <torusGeometry args={[W * f, 0.006, 6, 28]} />
        </mesh>
      ))}
      <mesh position={[W * 0.46, 0.006, 0]} material={m.ember}>
        <sphereGeometry args={[0.009, 8, 8]} />
      </mesh>
      <mesh position={[0, -H * 0.3, 0]} material={m.steel}>
        <cylinderGeometry args={[0.006, 0.02, H * 0.6, 8]} />
      </mesh>
    </group>
  );
};

/** Clay diya with a flame. */
const Diya: React.FC<FixtureProps> = ({ size, material, isGhost }) => {
  const [W, H] = size;
  const m = mats(material, isGhost);
  return (
    <group>
      <mesh position={[0, H * 0.2, 0]} material={m.clay}>
        <cylinderGeometry args={[W / 2, W * 0.3, H * 0.4, 16]} />
      </mesh>
      <mesh position={[W * 0.25, H * 0.6, 0]} material={m.flame}>
        <coneGeometry args={[0.014, H * 0.45, 8]} />
      </mesh>
    </group>
  );
};

/** Ashtray with a lit cigarette. */
const Cigarette: React.FC<FixtureProps> = ({ size, material, isGhost }) => {
  const [W, H] = size;
  const m = mats(material, isGhost);
  return (
    <group>
      <mesh position={[0, H * 0.3, 0]} material={m.iron}>
        <cylinderGeometry args={[W / 2, W * 0.42, H * 0.6, 20]} />
      </mesh>
      <mesh position={[W * 0.15, H * 0.75, 0]} rotation={[0, 0, Math.PI / 2 - 0.15]} material={m.paper}>
        <cylinderGeometry args={[0.005, 0.005, W * 0.8, 8]} />
      </mesh>
      <mesh position={[W * 0.53, H * 0.82, 0]} material={m.ember}>
        <sphereGeometry args={[0.007, 8, 8]} />
      </mesh>
    </group>
  );
};

/** A jhadu (broom) leaning over a little dust pile. */
const Broom: React.FC<FixtureProps> = ({ size, material, isGhost }) => {
  const [W, H, D] = size;
  const m = mats(material, isGhost);
  return (
    <group>
      <mesh position={[0, 0.02, 0]} material={m.body}>
        <coneGeometry args={[W * 0.35, 0.04, 16]} />
      </mesh>
      <group position={[W * 0.1, 0, 0]} rotation={[0, 0, 0.35]}>
        <mesh position={[0, H * 0.18, 0]} material={m.straw}>
          <coneGeometry args={[W * 0.22, H * 0.36, 12, 1, true]} />
        </mesh>
        <mesh position={[0, H * 0.62, 0]} material={m.wood}>
          <cylinderGeometry args={[0.01, 0.012, H * 0.55, 8]} />
        </mesh>
      </group>
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.body}>
        <circleGeometry args={[Math.max(W, D) * 0.5, 20]} />
      </mesh>
    </group>
  );
};

/** Room heater with a glowing grille. */
const Heater: React.FC<FixtureProps> = ({ size, material, isGhost, outline }) => {
  const [W, H, D] = size;
  const m = mats(material, isGhost);
  return (
    <group>
      <mesh position={[0, H / 2, 0]} material={m.body}>
        <boxGeometry args={[W, H, D]} />
        {outline}
      </mesh>
      {[0.3, 0.45, 0.6, 0.75].map((f) => (
        <mesh key={f} position={[0, H * f, D / 2 + 0.002]} material={m.glow}>
          <boxGeometry args={[W * 0.75, 0.018, 0.004]} />
        </mesh>
      ))}
    </group>
  );
};

export const SOURCE_FIXTURES: Record<string, React.FC<FixtureProps>> = {
  'pm25-stove-frying': Stove,
  'pm25-stove-boiling': (props) => <Stove {...props} pot />,
  'pm25-tawa': Tawa,
  'pm25-incense': Incense,
  'pm25-mosquito-coil': Coil,
  'pm25-candle': Diya,
  'pm25-cigarette': Cigarette,
  'pm25-sweeping': Broom,
  'pm25-heater': Heater,
};
