import React from 'react';
import { Canvas, type CanvasProps } from './Canvas';

export type ViewportCanvasProps = CanvasProps;

export const ViewportCanvas: React.FC<ViewportCanvasProps> = (props) => {
  return <Canvas {...props} />;
};

export default ViewportCanvas;
