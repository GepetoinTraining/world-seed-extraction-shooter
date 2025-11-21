/// <reference types="vite/client" />

// Explicitly extend the JSX namespace to include Three.js elements provided by R3F
import { ReactThreeFiber } from '@react-three/fiber';

declare global {
  namespace JSX {
    interface IntrinsicElements extends ReactThreeFiber.IntrinsicElements {}
  }
}