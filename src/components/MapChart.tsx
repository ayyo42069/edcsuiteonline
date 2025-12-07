import React, { useMemo, useState } from 'react';
import { SymbolHelper } from '../core/types';
import { Tools } from '../core/tools';
import { getColorForValue } from '../utils/colorUtils';
import { LayoutGrid, Activity, Box, ExternalLink } from 'lucide-react';
import { Map3DViewer } from './Map3DViewer';
import { MapPopup } from './MapPopup';

interface MapChartProps {
    symbol: SymbolHelper;
    fileBuffer: ArrayBuffer;
}

type ChartMode = 'lines' | 'heatmap' | 'surface';

export const MapChart: React.FC<MapChartProps> = ({ symbol, fileBuffer }) => {
    const [mode, setMode] = useState<ChartMode>('lines');
    const [isPopupOpen, setIsPopupOpen] = useState(false);

    const isPercentMap = useMemo(() => {
        return (symbol.zAxisDescr || "").includes("%") || (symbol.xaxisUnits || "").includes("Duty cycle");
    }, [symbol]);

    const { x, y, z } = useMemo(() => {
        if (!fileBuffer || !symbol) return { x: [], y: [], z: [] };
        return Tools.readMapData(fileBuffer, symbol);
    }, [fileBuffer, symbol]);

    const processedData = useMemo(() => {
        if (x.length === 0 || y.length === 0 || z.length === 0) return null;

        // Apply factors/offsets - C# only swaps ADDRESSES, NOT corrections
        // X display uses xAxisCorrection/xAxisOffset (corrections are NOT swapped)
        const xReal = x.map(v => v * (symbol.xAxisCorrection || 1) + (symbol.xAxisOffset || 0));
        const zReal = z.map(row => row.map(v => v * (symbol.correction || 1) + (symbol.offset || 0)));

        // Find min/max for scaling
        const xMin = Math.min(...xReal);
        const xMax = Math.max(...xReal);
        const zMin = Math.min(...zReal.flat());
        const zMax = Math.max(...zReal.flat());

        return { xReal, zReal, xMin, xMax, zMin, zMax };
    }, [x, y, z, symbol]);

    if (!processedData) return <div className="p-4 text-zinc-500">No data for chart.</div>;

    const { xReal, zReal, xMin, xMax, zMin, zMax } = processedData;

    // Dimensions
    const width = 600;
    const height = 300;
    const padding = 40;

    const innerWidth = width - padding * 2;
    const innerHeight = height - padding * 2;

    // Scales
    const xScale = (val: number) => ((val - xMin) / (xMax - xMin || 1)) * innerWidth + padding;

    // Use fixed 0-100 scale for Z if percent map, otherwise relative
    const rangeMin = isPercentMap ? 0 : zMin;
    const rangeMax = isPercentMap ? 100 : zMax;

    const zScale = (val: number) => height - padding - ((val - rangeMin) / (rangeMax - rangeMin || 1)) * innerHeight;

    // Render Lines
    const renderLines = () => {
        return zReal.map((row, rowIndex) => {
            const points = row.map((zVal, xIndex) => {
                return `${xScale(xReal[xIndex])},${zScale(zVal)}`;
            }).join(' ');

            const ratio = rowIndex / (y.length - 1 || 1);
            // Simple blue-red for lines mode
            const r = Math.floor(ratio * 255);
            const b = Math.floor((1 - ratio) * 255);
            const color = `rgb(${r}, 0, ${b})`;

            return <polyline key={rowIndex} points={points} fill="none" stroke={color} strokeWidth="2" opacity="0.8" />;
        });
    };

    // Render Heatmap
    const renderHeatmap = () => {
        const cellWidth = innerWidth / xReal.length;
        const cellHeight = innerHeight / y.length;

        return zReal.map((row, rowIndex) => {
            return row.map((zVal, colIndex) => {
                const color = getColorForValue(zVal, rangeMin, rangeMax);
                return (
                    <rect
                        key={`${rowIndex}-${colIndex}`}
                        x={padding + colIndex * cellWidth}
                        y={padding + rowIndex * cellHeight} // Top-down: Y increases downwards
                        width={cellWidth}
                        height={cellHeight}
                        fill={color}
                        stroke="rgba(0,0,0,0.1)"
                    />
                );
            });
        });
    };

    return (
        <div className="flex flex-col w-full h-full bg-zinc-950 p-4 border-b border-zinc-800">
            <div className="flex justify-between items-center mb-3">
                <div>
                    <h3 className="font-bold text-zinc-100 text-sm">Map Visualization</h3>
                    <div className="text-xs text-zinc-500 mt-0.5">
                        {mode === 'lines' && '2D Lines (Y-axis slices)'}
                        {mode === 'heatmap' && 'Top-Down Heatmap'}
                        {mode === 'surface' && 'Interactive 3D Surface'}
                        {isPercentMap && <span className="ml-2 text-blue-400">(0-100% Scale)</span>}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Pop-out button */}
                    <button
                        onClick={() => setIsPopupOpen(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
                        title="Open map editor in popup"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Pop Out
                    </button>

                    <div className="flex bg-zinc-900 p-1 rounded border border-zinc-800">
                        <button
                            onClick={() => setMode('lines')}
                            className={`p-1.5 rounded transition-colors ${mode === 'lines' ? 'bg-zinc-800 text-blue-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                            title="2D Lines"
                        >
                            <Activity className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setMode('heatmap')}
                            className={`p-1.5 rounded transition-colors ${mode === 'heatmap' ? 'bg-zinc-800 text-blue-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                            title="Heatmap"
                        >
                            <LayoutGrid className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setMode('surface')}
                            className={`p-1.5 rounded transition-colors ${mode === 'surface' ? 'bg-zinc-800 text-blue-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                            title="3D Surface"
                        >
                            <Box className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex-1 min-h-0 relative border border-zinc-800 rounded bg-zinc-900/50 overflow-hidden">
                {mode === 'surface' ? (
                    <Map3DViewer
                        xReal={xReal}
                        zReal={zReal}
                        xMin={xMin}
                        xMax={xMax}
                        valMin={rangeMin} // Use consistent range for 3D color/height too
                        valMax={rangeMax}
                        xLabel={symbol.xaxisUnits || "X"}
                        yLabel={symbol.yaxisUnits || "Y"}
                        zLabel={symbol.zAxisDescr || "Z"}
                    />
                ) : (
                    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
                        {/* Axes */}
                        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#555" strokeWidth="1" />
                        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#555" strokeWidth="1" />

                        {mode === 'lines' ? renderLines() : renderHeatmap()}

                        {/* Labels */}
                        <text x={padding} y={height - 10} fill="#71717a" fontSize="10">{xMin.toFixed(0)}</text>
                        <text x={width - padding} y={height - 10} fill="#71717a" fontSize="10" textAnchor="end">{xMax.toFixed(0)}</text>

                        {mode === 'lines' && (
                            <>
                                <text x={10} y={height - padding} fill="#71717a" fontSize="10" transform={`rotate(-90, 10, ${height - padding})`}>{rangeMin.toFixed(0)}</text>
                                <text x={10} y={padding} fill="#71717a" fontSize="10" transform={`rotate(-90, 10, ${padding})`}>{rangeMax.toFixed(0)}</text>
                            </>
                        )}
                    </svg>
                )}
            </div>

            {/* Map Popup Modal */}
            <MapPopup
                symbol={symbol}
                fileBuffer={fileBuffer}
                isOpen={isPopupOpen}
                onClose={() => setIsPopupOpen(false)}
            />
        </div>
    );
};
