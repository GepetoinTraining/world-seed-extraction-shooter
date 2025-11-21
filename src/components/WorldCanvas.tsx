import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Stars, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { IActiveSession } from '../types';
import { Box, Overlay, Center, Loader, Text, Stack } from '@mantine/core';

// --- 2D FALLBACK COMPONENT ---
const TacticalMap: React.FC<{ session: IActiveSession }> = ({ session }) => {
  return (
    <Box pos="relative" h="100%" w="100%" bg="black">
      <Overlay opacity={0.2} gradient="linear-gradient(90deg, #00ff88 1px, transparent 1px)" zIndex={1} />
      <Center h="100%" style={{ flexDirection: 'column' }}>
        <Loader color="emerald" type="bars" />
        <Text c="emerald" mt="md" ff="monospace" size="xs">VISUAL_CORTEX_OFFLINE</Text>
        <Text c="dimmed" size="xs">TACTICAL MODE: {session.layerId}</Text>
      </Center>
    </Box>
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

const Ground = () => (
  <group>
    <gridHelper args={[100, 50, 0x444444, 0x222222]} position={[0, 0, 0]} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]} receiveShadow>
      <planeGeometry args={[100, 100]} />
      <meshBasicMaterial color="#050505" />
    </mesh>
  </group>
);

export const WorldCanvas: React.FC<{ session: IActiveSession }> = ({ session }) => {
  return (
    <Box h="100%" w="100%" bg="black" pos="relative">
       <Box pos="absolute" top={16} left={16} style={{ zIndex: 10, pointerEvents: 'none' }}>
          <Text size="xs" c="emerald" ff="monospace">[VISUAL_CORTEX]: ONLINE</Text>
          <Text size="xs" c="emerald" ff="monospace">[LAYER]: {session.layerId}</Text>
       </Box>

       <Canvas shadows dpr={[1, 2]}>
          <PerspectiveCamera makeDefault position={[20, 20, 20]} fov={35} />
          <OrbitControls target={[0, 0, 0]} maxPolarAngle={Math.PI / 2.5} minDistance={10} maxDistance={50} />
          <ambientLight intensity={0.2} />
          <directionalLight position={[10, 20, 5]} intensity={1} castShadow />
          <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
          <Ground />
          <Avatar position={session.position} />
          <fog attach="fog" args={['#050505', 10, 60]} />
        </Canvas>
    </Box>
  );
};