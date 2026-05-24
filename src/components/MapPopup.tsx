"use client";

import React, { useEffect, useState } from 'react';
import { SymbolHelper } from '../core/types';
import { X, Maximize2, Minimize2, BarChart3, LineChart, Box, EyeOff } from 'lucide-react';
import { MapChart } from './MapChart';
import { MapEditor } from './MapEditor';

interface MapPopupProps {
    symbol: SymbolHelper;
    fileBuffer: ArrayBuffer;
    isOpen: boolean;
    onClose: () => void;
}

type ChartMode = 'hidden' | 'lines' | 'heatmap' | 'surface';

export const MapPopup: React.FC<MapPopupProps> = ({ symbol, fileBuffer, isOpen, onClose }) => {
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [chartMode, setChartMode] = useState<ChartMode>('hidden');

    // Lock body scroll while open + close on Esc (when nothing else is intercepting).
    useEffect(() => {
        if (!isOpen) return;
        document.body.style.overflow = 'hidden';
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            // If the user is editing a cell, let the editor handle Escape itself
            // (commit/cancel) without closing the popup. We detect that via active element.
            const ae = document.activeElement as HTMLElement | null;
            if (ae && (ae.tagName === 'INPUT' || ae.isContentEditable)) return;
            onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = '';
            document.removeEventListener('keydown', onKey);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                className={`
                    bg-zinc-950 border border-zinc-700 rounded-xl shadow-2xl flex flex-col
                    transition-all duration-300 ease-out animate-in zoom-in-95 fade-in
                    ${isFullscreen ? 'w-full h-full m-0 rounded-none' : 'w-[95vw] h-[92vh] max-w-7xl'}
                `}
            >
                {/* Header */}
                <div className="flex-shrink-0 px-5 py-3 bg-zinc-900 border-b border-zinc-800 flex justify-between items-center rounded-t-xl gap-4">
                    <div className="min-w-0">
                        <h2 className="font-bold text-lg text-zinc-100 tracking-tight truncate">
                            {symbol.varname || "Unnamed Map"}
                        </h2>
                        <div className="flex gap-4 text-zinc-500 mt-0.5 text-xs flex-wrap">
                            <span><span className="text-zinc-600">addr</span> <span className="text-zinc-300 font-mono">0x{symbol.flashStartAddress.toString(16).toUpperCase()}</span></span>
                            <span><span className="text-zinc-600">size</span> <span className="text-zinc-300">{symbol.xAxisLength} × {symbol.yAxisLength}</span></span>
                            <span><span className="text-zinc-600">factor</span> <span className="text-zinc-300">{symbol.correction}</span></span>
                            {symbol.offset !== 0 && (
                                <span><span className="text-zinc-600">offset</span> <span className="text-zinc-300">{symbol.offset}</span></span>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                        {/* Chart mode picker */}
                        <div className="flex bg-zinc-800 border border-zinc-700 rounded-lg overflow-hidden text-xs">
                            <button
                                onClick={() => setChartMode('hidden')}
                                className={`px-2 py-1.5 transition-colors ${chartMode === 'hidden' ? 'bg-zinc-700 text-blue-300' : 'text-zinc-500 hover:text-zinc-300'}`}
                                title="Hide chart"
                            >
                                <EyeOff className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setChartMode('lines')}
                                className={`px-2 py-1.5 transition-colors ${chartMode === 'lines' ? 'bg-zinc-700 text-blue-300' : 'text-zinc-500 hover:text-zinc-300'}`}
                                title="2D line chart"
                            >
                                <LineChart className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setChartMode('heatmap')}
                                className={`px-2 py-1.5 transition-colors ${chartMode === 'heatmap' ? 'bg-zinc-700 text-blue-300' : 'text-zinc-500 hover:text-zinc-300'}`}
                                title="Heatmap"
                            >
                                <BarChart3 className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setChartMode('surface')}
                                className={`px-2 py-1.5 transition-colors ${chartMode === 'surface' ? 'bg-zinc-700 text-blue-300' : 'text-zinc-500 hover:text-zinc-300'}`}
                                title="3D surface"
                            >
                                <Box className="w-4 h-4" />
                            </button>
                        </div>

                        <button
                            onClick={() => setIsFullscreen(!isFullscreen)}
                            className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                        >
                            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-lg bg-zinc-800 hover:bg-red-600 text-zinc-400 hover:text-white transition-colors"
                            title="Close (Esc)"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Axis legend */}
                <div className="flex-shrink-0 px-5 py-2 bg-zinc-900/50 border-b border-zinc-800 flex gap-6 text-xs flex-wrap">
                    <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-400 font-semibold">X</span>
                        <span className="text-zinc-400">{symbol.xAxisDescr || "X axis"}</span>
                        {symbol.xaxisUnits && <span className="text-zinc-600">({symbol.xaxisUnits})</span>}
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-green-600/20 text-green-400 font-semibold">Y</span>
                        <span className="text-zinc-400">{symbol.yAxisDescr || "Y axis"}</span>
                        {symbol.yaxisUnits && <span className="text-zinc-600">({symbol.yaxisUnits})</span>}
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-purple-600/20 text-purple-400 font-semibold">Z</span>
                        <span className="text-zinc-400">{symbol.zAxisDescr || "Value"}</span>
                    </div>
                </div>

                {/* Chart (optional) */}
                {chartMode !== 'hidden' && (
                    <div className="flex-shrink-0 h-72 border-b border-zinc-800">
                        {/* MapChart manages its own internal mode; we just mount it.
                            (Future improvement: pass the chartMode through if MapChart accepts it.) */}
                        <MapChart symbol={symbol} fileBuffer={fileBuffer} />
                    </div>
                )}

                {/* Editor */}
                <div className="flex-1 overflow-hidden">
                    <MapEditor symbol={symbol} fileBuffer={fileBuffer} />
                </div>
            </div>
        </div>
    );
};
