import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, PerspectiveCamera, Plane, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { getRGBForValue } from '../utils/colorUtils';

interface Map3DViewerProps {
    xReal: number[];
    zReal: number[][]; // zReal is rows (y) * cols (x). But in 3D "Y" is up, so map Z value -> 3D Y.
    xMin: number;
    xMax: number;
    valMin: number;
    valMax: number;
    xLabel: string;
    yLabel: string;
    zLabel: string;
}

// Inner component to handle the mesh logic
const SurfaceMesh: React.FC<{ 
    xReal: number[], 
    zReal: number[][], 
    valMin: number, 
    valMax: number,
    width: number,
    depth: number 
}> = ({ xReal, zReal, valMin, valMax, width, depth }) => {
    
    const meshRef = useRef<THREE.Mesh>(null);

    const geometry = useMemo(() => {
        const rows = zReal.length;
        const cols = zReal[0]?.length || 0;
        if (rows < 2 || cols < 2) return null;

        // Create a plane with segments matching our data grid
        // width (X), height (Y in 2D plane, Z in 3D space usually depth)
        // PlaneGeometry(width, height, widthSegments, heightSegments)
        const geo = new THREE.PlaneGeometry(width, depth, cols - 1, rows - 1);
        
        // Displace vertices
        const posAttribute = geo.attributes.position;
        const colors = [];

        // PlaneGeometry generates vertices row by row? 
        // Standard Plane is X (width) and Y (height). We rotate it -90deg later to lie flat on XZ.
        // Then Y becomes UP.
        // Vertices order: usually row by row, top-left to bottom-right.
        
        for (let i = 0; i < posAttribute.count; i++) {
            // Map index to grid coordinates
            // PlaneGeometry creates (cols+1) * (rows+1) vertices
            // We need to match these to our data
            
            // Simple approach: X is index % (cols), Y is floor(index / cols)
            // But we want to set the Z component of the plane (which becomes Y in world space after rotation)
            
            const ix = i % cols;
            const iy = Math.floor(i / cols);
            
            // Data mapping:
            // zReal[row][col]
            // We need to flip Y because texture coords usually start bottom-left or top-left?
            // Let's assume zReal[0] corresponds to "top" (negative Z or positive Y in plane space)
            
            // Safety check
            const rowData = zReal[iy];
            if (rowData) {
                const value = rowData[ix];
                if (value !== undefined) {
                    // Normalize height to reasonable 3D scale (e.g. 0 to 10)
                    // We want the visual height to be proportional but manageable
                    const normalizedHeight = ((value - valMin) / (valMax - valMin || 1)) * 5; // Max height 5 units
                    
                    // Plane is created in XY plane. Z is 0.
                    // We will manipulate the Z coordinate of the geometry (local space), 
                    // which becomes UP when we rotate the mesh -Math.PI/2 on X.
                    posAttribute.setZ(i, normalizedHeight);

                    // Calculate Color
                    const { r, g, b } = getRGBForValue(value, valMin, valMax);
                    colors.push(r, g, b);
                } else {
                   colors.push(0, 0, 0);
                }
            } else {
                colors.push(0, 0, 0);
            }
        }

        geo.computeVertexNormals();
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        
        return geo;
    }, [xReal, zReal, valMin, valMax, width, depth]);

    if (!geometry) return null;

    return (
        <group>
            {/* Solid Mesh with Vertex Colors */}
            <mesh ref={meshRef} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
                <meshStandardMaterial 
                    vertexColors 
                    side={THREE.DoubleSide} 
                    roughness={0.5} 
                    metalness={0.2}
                    flatShading={false}
                />
            </mesh>

            {/* Wireframe Overlay */}
            <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
                <meshBasicMaterial color="#000000" wireframe opacity={0.2} transparent />
            </mesh>
        </group>
    );
};

export const Map3DViewer: React.FC<Map3DViewerProps> = ({ 
    xReal, zReal, xMin, xMax, valMin, valMax, xLabel, yLabel, zLabel 
}) => {
    // 3D Scene setup
    // Grid Size: 10x10 units
    const width = 10;
    const depth = 10;

    return (
        <div className="w-full h-full bg-zinc-900 rounded-lg overflow-hidden shadow-inner">
            <Canvas shadows>
                <PerspectiveCamera makeDefault position={[12, 10, 12]} fov={50} />
                <OrbitControls 
                    enableDamping 
                    dampingFactor={0.05} 
                    minDistance={5} 
                    maxDistance={30}
                    target={[0, 2, 0]} 
                />
                
                {/* Lighting */}
                <ambientLight intensity={0.5} />
                <pointLight position={[10, 10, 10]} intensity={1} />
                <pointLight position={[-10, 10, -10]} intensity={0.5} />

                {/* The Map Surface */}
                <SurfaceMesh 
                    xReal={xReal} 
                    zReal={zReal} 
                    valMin={valMin} 
                    valMax={valMax} 
                    width={width} 
                    depth={depth}
                />

                {/* Base Grid */}
                <Grid 
                    position={[0, 0, 0]} 
                    args={[10, 10]} 
                    cellSize={1} 
                    cellThickness={0.5} 
                    cellColor="#3f3f46" 
                    sectionSize={5} 
                    sectionThickness={1} 
                    sectionColor="#71717a" 
                    fadeDistance={30} 
                    infiniteGrid 
                />
                
                {/* Axis Labels */}
                <group position={[-width/2 - 1, 0, width/2 + 1]}>
                    {/* X Axis Label */}
                    <Text 
                        position={[width/2, 0, 1]} 
                        rotation={[-Math.PI/2, 0, 0]} 
                        fontSize={0.5} 
                        color="#a1a1aa"
                    >
                        {xLabel}
                    </Text>
                    
                    {/* Z Axis (Depth) Label - technically Y in data */}
                    <Text 
                        position={[-1, 0, -depth/2]} 
                        rotation={[-Math.PI/2, 0, Math.PI/2]} 
                        fontSize={0.5} 
                        color="#a1a1aa"
                    >
                        {yLabel}
                    </Text>

                     {/* Y Axis (Height) Label - Map Value */}
                     <Text 
                        position={[-1, 2.5, -depth - 1]} 
                        rotation={[0, Math.PI/4, 0]} // Angle it towards camera slightly
                        fontSize={0.5} 
                        color="#a1a1aa"
                    >
                        {zLabel}
                    </Text>
                </group>

                {/* Min/Max Value Markers */}
                <Text position={[-width/2, 0.2, width/2]} fontSize={0.3} color="white" anchorX="right">
                    {valMin.toFixed(0)}
                </Text>
                <Text position={[-width/2, 5.2, width/2]} fontSize={0.3} color="red" anchorX="right">
                    {valMax.toFixed(0)}
                </Text>
                 
                 {/* Height rod */}
                <mesh position={[-width/2 - 0.2, 2.5, width/2]} scale={[0.1, 5, 0.1]}>
                    <boxGeometry />
                    <meshStandardMaterial color="#333" />
                </mesh>

            </Canvas>
        </div>
    );
};
