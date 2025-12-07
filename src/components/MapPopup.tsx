"use client";

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { SymbolHelper } from '../core/types';
import { Tools } from '../core/tools';
import { useFileStore } from '../store/useFileStore';
import { getColorForValue, getTextColorForBackground } from '../utils/colorUtils';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { SelectionToolbar } from './SelectionToolbar';

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

interface CellCoord {
    x: number;
    y: number;
}

export const MapPopup: React.FC<MapPopupProps> = ({ symbol, fileBuffer, isOpen, onClose }) => {
    const updateMapData = useFileStore(state => state.updateMapData);
    const updateMapDataBatch = useFileStore(state => state.updateMapDataBatch);

    const [editCell, setEditCell] = useState<EditState | null>(null);
    const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
    const [selectionAnchor, setSelectionAnchor] = useState<CellCoord | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);
    const lastEditCellRef = useRef<CellCoord | null>(null);

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

    // Focus input when editing starts
    useEffect(() => {
        if (editCell && inputRef.current) {
            const isNewCell = !lastEditCellRef.current ||
                lastEditCellRef.current.x !== editCell.xIndex ||
                lastEditCellRef.current.y !== editCell.yIndex;

            if (isNewCell) {
                inputRef.current.focus();
                inputRef.current.select();
                lastEditCellRef.current = { x: editCell.xIndex, y: editCell.yIndex };
            }
        } else if (!editCell) {
            lastEditCellRef.current = null;
        }
    }, [editCell]);

    // Close on Escape, handle other keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen) return;

            if (e.key === 'Escape') {
                if (selectedCells.size > 0) {
                    setSelectedCells(new Set());
                    setSelectionAnchor(null);
                } else if (editCell) {
                    setEditCell(null);
                } else {
                    onClose();
                }
            }

            if (e.ctrlKey && e.key === 'a' && !editCell) {
                e.preventDefault();
                const allCells = new Set<string>();
                for (let yi = 0; yi < y.length; yi++) {
                    for (let xi = 0; xi < x.length; xi++) {
                        allCells.add(`${xi},${yi}`);
                    }
                }
                setSelectedCells(allCells);
            }
        };

        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
            document.body.style.overflow = 'hidden';
        }
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [isOpen, onClose, selectedCells.size, editCell, x.length, y.length]);

    // Mouse up handler for drag selection
    useEffect(() => {
        const handleMouseUp = () => setIsDragging(false);
        window.addEventListener('mouseup', handleMouseUp);
        return () => window.removeEventListener('mouseup', handleMouseUp);
    }, []);

    const cellKey = (x: number, y: number) => `${x},${y}`;
    const parseKey = (key: string): CellCoord => {
        const [x, y] = key.split(',').map(Number);
        return { x, y };
    };

    const getSelectedCellsArray = useCallback((): CellCoord[] => {
        return Array.from(selectedCells).map(parseKey);
    }, [selectedCells]);

    const getCellsInRange = (start: CellCoord, end: CellCoord): Set<string> => {
        const cells = new Set<string>();
        const minX = Math.min(start.x, end.x);
        const maxX = Math.max(start.x, end.x);
        const minY = Math.min(start.y, end.y);
        const maxY = Math.max(start.y, end.y);

        for (let yi = minY; yi <= maxY; yi++) {
            for (let xi = minX; xi <= maxX; xi++) {
                cells.add(cellKey(xi, yi));
            }
        }
        return cells;
    };

    const handleCellMouseDown = (xIdx: number, yIdx: number, e: React.MouseEvent) => {
        e.preventDefault();
        const key = cellKey(xIdx, yIdx);

        if (e.ctrlKey || e.metaKey) {
            const newSelection = new Set(selectedCells);
            if (newSelection.has(key)) {
                newSelection.delete(key);
            } else {
                newSelection.add(key);
            }
            setSelectedCells(newSelection);
            setSelectionAnchor({ x: xIdx, y: yIdx });
        } else if (e.shiftKey && selectionAnchor) {
            const range = getCellsInRange(selectionAnchor, { x: xIdx, y: yIdx });
            setSelectedCells(range);
        } else {
            if (selectedCells.size <= 1 && !selectedCells.has(key)) {
                setSelectedCells(new Set([key]));
                setSelectionAnchor({ x: xIdx, y: yIdx });
                setIsDragging(true);
            } else if (selectedCells.has(key) && selectedCells.size === 1) {
                const rawValue = z[yIdx]?.[xIdx] ?? 0;
                const formatted = formatValue(rawValue, symbol.correction, symbol.offset);
                setEditCell({ xIndex: xIdx, yIndex: yIdx, value: formatted });
            } else {
                setSelectedCells(new Set([key]));
                setSelectionAnchor({ x: xIdx, y: yIdx });
                setIsDragging(true);
            }
        }
    };

    const handleCellMouseEnter = (xIdx: number, yIdx: number) => {
        if (isDragging && selectionAnchor) {
            const range = getCellsInRange(selectionAnchor, { x: xIdx, y: yIdx });
            setSelectedCells(range);
        }
    };

    const handleCellDoubleClick = (xIdx: number, yIdx: number, rawValue: number) => {
        const formatted = formatValue(rawValue, symbol.correction, symbol.offset);
        setEditCell({ xIndex: xIdx, yIndex: yIdx, value: formatted });
        setSelectedCells(new Set());
    };

    const formatValue = (val: number, factor: number, offset: number, units?: string) => {
        const f = factor !== undefined ? factor : 1;
        const o = offset !== undefined ? offset : 0;
        const real = val * f + o;
        const formatted = parseFloat(real.toFixed(3)).toString();

        // Append unit symbol for axis values if units are provided
        if (units) {
            const unitLower = units.toLowerCase();
            if (unitLower.includes('°c') || unitLower.includes('degc') || unitLower.includes('celcius') || unitLower.includes('celsius')) {
                return `${formatted}°C`;
            } else if (unitLower.includes('%') || unitLower.includes('percent')) {
                return `${formatted}%`;
            } else if (unitLower.includes('°') || unitLower.includes('deg') || unitLower.includes('btdc')) {
                return `${formatted}°`;
            }
        }
        return formatted;
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

    const handleBatchApply = (operation: 'set' | 'add' | 'multiply' | 'addPercent', value: number) => {
        const cells = getSelectedCellsArray();
        if (cells.length === 0) return;
        updateMapDataBatch(symbol, cells, operation, value);
    };

    const handleClearSelection = () => {
        setSelectedCells(new Set());
        setSelectionAnchor(null);
    };

    if (!isOpen) return null;

    const hasSelection = selectedCells.size > 0 && !editCell;

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

                {/* Axis Info Bar - C# only swaps ADDRESSES, NOT descriptions/units/corrections. X display uses xAxis info, Y uses yAxis info */}
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

                {/* Selection Toolbar */}
                {hasSelection && (
                    <SelectionToolbar
                        selectedCount={selectedCells.size}
                        onApply={handleBatchApply}
                        onClear={handleClearSelection}
                    />
                )}

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
                                        {formatValue(val, symbol.xAxisCorrection, symbol.xAxisOffset, symbol.xaxisUnits)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {y.map((yVal, yIdx) => (
                                <tr key={`y-${yIdx}`} className="group">
                                    <th className="sticky left-0 z-10 p-3 bg-zinc-900 border-r border-b border-zinc-700 text-green-400 font-medium group-hover:bg-zinc-800 transition-colors">
                                        {formatValue(yVal, symbol.yAxisCorrection, symbol.yAxisOffset, symbol.yaxisUnits)}
                                    </th>

                                    {z[yIdx]?.map((zVal, xIdx) => {
                                        const isEditing = editCell?.xIndex === xIdx && editCell?.yIndex === yIdx;
                                        const isSelected = selectedCells.has(cellKey(xIdx, yIdx));
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
                                                    p-0 border-r border-b min-w-[70px] relative select-none
                                                    ${!isEditing ? 'cursor-pointer transition-all hover:scale-105 hover:z-10 hover:shadow-lg' : ''}
                                                    ${isEditing ? 'bg-zinc-800' : ''}
                                                    ${isSelected && !isEditing ? 'ring-2 ring-blue-500 ring-inset z-10' : 'border-zinc-800/50'}
                                                `}
                                                onMouseDown={(e) => handleCellMouseDown(xIdx, yIdx, e)}
                                                onMouseEnter={() => handleCellMouseEnter(xIdx, yIdx)}
                                                onDoubleClick={() => handleCellDoubleClick(xIdx, yIdx, zVal)}
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
                    <span>
                        Click to select • Shift+click for range • Ctrl+click to toggle • Drag to select area • Double-click to edit
                    </span>
                    <span>Factor: {symbol.correction} | Offset: {symbol.offset}</span>
                </div>
            </div>
        </div>
    );
};
