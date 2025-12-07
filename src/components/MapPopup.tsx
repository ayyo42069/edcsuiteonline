"use client";

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { SymbolHelper } from '../core/types';
import { Tools } from '../core/tools';
import { useFileStore } from '../store/useFileStore';
import { getColorForValue, getTextColorForBackground } from '../utils/colorUtils';
import { X, Maximize2, Minimize2 } from 'lucide-react';

interface MapPopupProps {
    symbol: SymbolHelper;
    fileBuffer: ArrayBuffer;
    isOpen: boolean;
    onClose: () => void;
}

interface EditState {
    xIndex: number;
    yIndex: number;
    value: string;
}

export const MapPopup: React.FC<MapPopupProps> = ({ symbol, fileBuffer, isOpen, onClose }) => {
    const updateMapData = useFileStore(state => state.updateMapData);
    const [editCell, setEditCell] = useState<EditState | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);
    const lastEditCellRef = useRef<{ xIndex: number; yIndex: number } | null>(null);

    const isPercentMap = useMemo(() => {
        return (symbol.zAxisDescr || "").includes("%") || (symbol.xaxisUnits || "").includes("Duty cycle");
    }, [symbol]);

    const isDegreeMap = useMemo(() => {
        const desc = (symbol.zAxisDescr || "").toLowerCase();
        return desc.includes("degrees") || desc.includes("btdc") || desc.includes("deg ") || desc.includes("deg)") || desc.includes("°");
    }, [symbol]);

    const { x, y, z, zMin, zMax } = useMemo(() => {
        if (!fileBuffer || !symbol) return { x: [], y: [], z: [], zMin: 0, zMax: 0 };
        const data = Tools.readMapData(fileBuffer, symbol);

        let min = Number.MAX_VALUE;
        let max = Number.MIN_VALUE;

        data.z.forEach(row => row.forEach(val => {
            const real = val * (symbol.correction || 1) + (symbol.offset || 0);
            if (real < min) min = real;
            if (real > max) max = real;
        }));

        return { ...data, zMin: min, zMax: max };
    }, [fileBuffer, symbol]);

    // Only focus/select when starting to edit a NEW cell, not on value changes
    useEffect(() => {
        if (editCell && inputRef.current) {
            const isNewCell = !lastEditCellRef.current ||
                lastEditCellRef.current.xIndex !== editCell.xIndex ||
                lastEditCellRef.current.yIndex !== editCell.yIndex;

            if (isNewCell) {
                inputRef.current.focus();
                inputRef.current.select();
                lastEditCellRef.current = { xIndex: editCell.xIndex, yIndex: editCell.yIndex };
            }
        } else if (!editCell) {
            lastEditCellRef.current = null;
        }
    }, [editCell]);

    // Close on Escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden';
        }
        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = '';
        };
    }, [isOpen, onClose]);

    const formatValue = (val: number, factor: number, offset: number) => {
        const f = factor !== undefined ? factor : 1;
        const o = offset !== undefined ? offset : 0;
        const real = val * f + o;
        return parseFloat(real.toFixed(3)).toString();
    };

    const handleCellClick = (xIndex: number, yIndex: number, rawValue: number) => {
        const formatted = formatValue(rawValue, symbol.correction, symbol.offset);
        setEditCell({ xIndex, yIndex, value: formatted });
    };

    const handleSave = () => {
        if (!editCell) return;
        const num = parseFloat(editCell.value);
        if (!isNaN(num)) {
            updateMapData(symbol, editCell.xIndex, editCell.yIndex, num);
        }
        setEditCell(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSave();
        else if (e.key === 'Escape') setEditCell(null);
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                ref={modalRef}
                className={`
                    bg-zinc-950 border border-zinc-700 rounded-xl shadow-2xl flex flex-col
                    transition-all duration-300 ease-out animate-in zoom-in-95 fade-in
                    ${isFullscreen ? 'w-full h-full m-0 rounded-none' : 'w-[95vw] h-[90vh] max-w-7xl'}
                `}
            >
                {/* Header */}
                <div className="flex-shrink-0 px-6 py-4 bg-zinc-900 border-b border-zinc-800 flex justify-between items-center rounded-t-xl">
                    <div>
                        <h2 className="font-bold text-xl text-zinc-100 tracking-tight">
                            {symbol.varname || "Unnamed Map"}
                        </h2>
                        <div className="flex gap-6 text-zinc-500 mt-1 text-sm">
                            <span>Address: <span className="text-zinc-300 font-mono">0x{symbol.flashStartAddress.toString(16).toUpperCase()}</span></span>
                            <span>Size: <span className="text-zinc-300">{symbol.xAxisLength} × {symbol.yAxisLength}</span></span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setIsFullscreen(!isFullscreen)}
                            className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                        >
                            {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-lg bg-zinc-800 hover:bg-red-600 text-zinc-400 hover:text-white transition-colors"
                            title="Close (Esc)"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Axis Info Bar */}
                <div className="flex-shrink-0 px-6 py-3 bg-zinc-900/50 border-b border-zinc-800 flex gap-8 text-sm">
                    <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-blue-600/20 text-blue-400 font-semibold text-xs">X</span>
                        <span className="text-zinc-400">{symbol.xAxisDescr || "X Axis"}</span>
                        {symbol.xaxisUnits && <span className="text-zinc-500">({symbol.xaxisUnits})</span>}
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-green-600/20 text-green-400 font-semibold text-xs">Y</span>
                        <span className="text-zinc-400">{symbol.yAxisDescr || "Y Axis"}</span>
                        {symbol.yaxisUnits && <span className="text-zinc-500">({symbol.yaxisUnits})</span>}
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-purple-600/20 text-purple-400 font-semibold text-xs">Z</span>
                        <span className="text-zinc-400">{symbol.zAxisDescr || "Value"}</span>
                    </div>
                </div>

                {/* Data Grid */}
                <div className="flex-1 overflow-auto p-4 custom-scrollbar">
                    <table className="w-max border-separate border-spacing-0 text-sm font-mono">
                        <thead className="sticky top-0 z-20">
                            <tr>
                                <th className="sticky left-0 z-30 p-3 min-w-[80px] bg-zinc-900 border-r border-b border-zinc-700 text-zinc-500 font-semibold text-xs uppercase tracking-wider">
                                    Y \ X
                                </th>
                                {x.map((val, idx) => (
                                    <th key={`x-${idx}`} className="p-3 min-w-[70px] bg-zinc-900 border-b border-r border-zinc-700 text-blue-400 font-medium">
                                        {formatValue(val, symbol.yAxisCorrection, symbol.yAxisOffset)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {y.map((yVal, yIdx) => (
                                <tr key={`y-${yIdx}`} className="group">
                                    <th className="sticky left-0 z-10 p-3 bg-zinc-900 border-r border-b border-zinc-700 text-green-400 font-medium group-hover:bg-zinc-800 transition-colors">
                                        {formatValue(yVal, symbol.xAxisCorrection, symbol.xAxisOffset)}
                                    </th>

                                    {z[yIdx]?.map((zVal, xIdx) => {
                                        const isEditing = editCell?.xIndex === xIdx && editCell?.yIndex === yIdx;
                                        const realVal = zVal * (symbol.correction || 1) + (symbol.offset || 0);

                                        const rangeMin = isPercentMap ? 0 : zMin;
                                        const rangeMax = isPercentMap ? 100 : zMax;

                                        const bgColor = getColorForValue(realVal, rangeMin, rangeMax);
                                        const textColor = getTextColorForBackground(realVal, rangeMin, rangeMax);

                                        return (
                                            <td
                                                key={`z-${yIdx}-${xIdx}`}
                                                style={{
                                                    backgroundColor: !isEditing ? bgColor : undefined,
                                                    color: !isEditing ? textColor : undefined
                                                }}
                                                className={`
                                                    p-0 border-r border-b border-zinc-800/50 min-w-[70px] relative
                                                    ${!isEditing ? 'cursor-pointer transition-all hover:scale-105 hover:z-10 hover:shadow-lg' : ''}
                                                    ${isEditing ? 'bg-zinc-800' : ''}
                                                `}
                                                onClick={() => !isEditing && handleCellClick(xIdx, yIdx, zVal)}
                                            >
                                                {isEditing ? (
                                                    <input
                                                        ref={inputRef}
                                                        type="text"
                                                        className="absolute inset-0 w-full h-full bg-zinc-800 text-zinc-100 text-center outline-none border-2 border-blue-500 font-mono text-sm"
                                                        value={editCell.value}
                                                        onChange={(e) => setEditCell({ ...editCell, value: e.target.value })}
                                                        onBlur={handleSave}
                                                        onKeyDown={handleKeyDown}
                                                    />
                                                ) : (
                                                    <div className="py-3 px-2 text-center font-medium">
                                                        {formatValue(zVal, symbol.correction, symbol.offset)}
                                                        {isPercentMap && <span className="opacity-50 text-xs ml-0.5">%</span>}
                                                        {isDegreeMap && <span className="opacity-50 text-xs ml-0.5">°</span>}
                                                    </div>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Footer */}
                <div className="flex-shrink-0 px-6 py-3 bg-zinc-900 border-t border-zinc-800 rounded-b-xl flex justify-between items-center text-sm text-zinc-500">
                    <span>Click any cell to edit • Press <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-xs">Enter</kbd> to save • <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-xs">Esc</kbd> to close</span>
                    <span>Factor: {symbol.correction} | Offset: {symbol.offset}</span>
                </div>
            </div>
        </div>
    );
};
