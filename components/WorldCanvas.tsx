import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Stars, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { IActiveSession } from '../types';

// Explicitly declare intrinsic elements to satisfy TypeScript
declare global {
  namespace JSX {
    interface IntrinsicElements {
      ambientLight: any;
      pointLight: any;
      directionalLight: any;
      mesh: any;
      group: any;
      octahedronGeometry: any;
      meshStandardMaterial: any;
      gridHelper: any;
      planeGeometry: any;
      meshBasicMaterial: any;
      boxGeometry: any;
      fog: any;
    }
  }
}

// --- UTILITIES ---

const isWebGLAvailable = () => {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch (e) {
    return false;
  }
};

// --- ERROR BOUNDARY ---

class ErrorBoundary extends React.Component<{children: React.ReactNode, fallback: React.ReactNode}, {hasError: boolean}> {
  constructor(props: {children: React.ReactNode, fallback: React.ReactNode}) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("WorldCanvas Renderer Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// --- 2D FALLBACK COMPONENT (TACTICAL MAP) ---

const TacticalMap: React.FC<{ session: IActiveSession }> = ({ session }) => {
  return (
    <div className="w-full h-full bg-black relative overflow-hidden font-mono p-4 select-none">
      {/* Grid Background */}
      <div className="absolute inset-0 opacity-20" 
           style={{
             backgroundImage: 'linear-gradient(#00ff88 1px, transparent 1px), linear-gradient(90deg, #00ff88 1px, transparent 1px)',
             backgroundSize: '40px 40px',
             backgroundPosition: 'center'
           }}>
      </div>
      
      {/* Status HUD */}
      <div className="absolute top-4 left-4 text-xs text-emerald-500/80 z-10 bg-black/50 p-2 border-l-2 border-emerald-500">
        <div className="font-bold">[RENDERER_FALLBACK]: ACTIVE</div>
        <div>[MODE]: 2D_TACTICAL_MAP</div>
        <div>[REASON]: WEBGL_CONTEXT_FAILURE</div>
        <div>[LAYER]: {session.layerId}</div>
        <div>[COORDS]: {session.position.x.toFixed(2)}, {session.position.z.toFixed(2)}</div>
      </div>

      {/* Player Marker (Center) */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center z-20">
        <div className="w-4 h-4 border-2 border-emerald-500 bg-emerald-500/20 rotate-45 animate-pulse shadow-[0_0_15px_#00ff88]" />
        <span className="text-[9px] text-emerald-500 mt-2 tracking-widest">UNIT_01</span>
      </div>
      
      {/* Mock POIs / Loot Markers relative to center for visual flavor */}
      <div className="absolute top-1/2 left-1/2 translate-x-24 translate-y-12 w-3 h-3 bg-purple-500/80 rounded-full animate-bounce" title="Unknown Signal" />
      <div className="absolute top-1/2 left-1/2 -translate-x-32 translate-y-20 w-3 h-3 bg-amber-500/80 rounded-full animate-bounce animation-delay-1000" title="Resource Node" />

      {/* Scanning Line Effect */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-emerald-500/5 to-transparent h-[20%] w-full animate-[scan_4s_ease-in-out_infinite] pointer-events-none" />
    </div>
  )
}

// --- 3D SCENE COMPONENTS ---

const Avatar = ({ position }: { position: { x: number, y: number, z: number } }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.01;
      meshRef.current.position.y = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.2;
    }
  });

  return (
    <mesh ref={meshRef} position={[position.x, 1, position.z]} castShadow>
      <octahedronGeometry args={[0.8, 0]} />
      <meshStandardMaterial color="#00ff88" wireframe={true} />
      <pointLight distance={5} intensity={2} color="#00ff88" />
    </mesh>
  );
};

const Ground = () => {
  return (
    <group>
      <gridHelper args={[100, 50, 0x444444, 0x222222]} position={[0, 0, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial color="#050505" />
      </mesh>
    </group>
  );
};

const LootDrop = ({ position, color }: { position: [number, number, number], color: string }) => {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if(ref.current) {
      ref.current.rotation.y += 0.02;
      ref.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 3) * 0.1;
    }
  });

  return (
    <group ref={ref} position={position}>
      <mesh>
        <boxGeometry args={[0.4, 0.4, 0.4]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
      </mesh>
      <pointLight distance={2} intensity={1} color={color} />
    </group>
  );
};

// --- MAIN COMPONENT ---

export const WorldCanvas: React.FC<{ session: IActiveSession }> = ({ session }) => {
  const webglCheck = useRef(isWebGLAvailable());

  // If WebGL is hard-disabled or missing, immediately fallback
  if (!webglCheck.current) {
    return <TacticalMap session={session} />;
  }

  return (
    <div className="w-full h-full bg-black relative">
       <div className="absolute top-4 left-4 z-10 pointer-events-none text-xs font-mono text-emerald-500">
          <div>[VISUAL_CORTEX]: ONLINE</div>
          <div>[CAM_RIG]: ISOMETRIC_FIXED</div>
          <div>[LAYER_ID]: {session.layerId}</div>
       </div>

      <ErrorBoundary fallback={<TacticalMap session={session} />}>
        <Canvas shadows dpr={[1, 2]}>
          <PerspectiveCamera makeDefault position={[20, 20, 20]} fov={35} />
          <OrbitControls 
            target={[0, 0, 0]} 
            maxPolarAngle={Math.PI / 2.5} 
            enableZoom={true}
            minDistance={10}
            maxDistance={50}
          />
          
          <ambientLight intensity={0.2} />
          <directionalLight position={[10, 20, 5]} intensity={1} castShadow />
          
          <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
          
          <Ground />
          <Avatar position={session.position} />
          
          {/* Random Mock Environment Props */}
          <LootDrop position={[3, 1, 3]} color="#a855f7" />
          <LootDrop position={[-4, 1, 2]} color="#22c55e" />
          <LootDrop position={[5, 1, -5]} color="#f59e0b" />

          {/* Fog to hide edges */}
          <fog attach="fog" args={['#050505', 10, 60]} />
        </Canvas>
      </ErrorBoundary>
    </div>
  );
};