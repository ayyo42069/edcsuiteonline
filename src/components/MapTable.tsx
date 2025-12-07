import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { SymbolHelper } from '../core/types';
import { Tools } from '../core/tools';
import { useFileStore } from '../store/useFileStore';
import { getColorForValue, getTextColorForBackground } from '../utils/colorUtils';
import { SelectionToolbar } from './SelectionToolbar';

interface MapTableProps {
    symbol: SymbolHelper;
    fileBuffer: ArrayBuffer;
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

export const MapTable: React.FC<MapTableProps> = ({ symbol, fileBuffer }) => {
    const updateMapData = useFileStore(state => state.updateMapData);
    const updateMapDataBatch = useFileStore(state => state.updateMapDataBatch);

    const [editCell, setEditCell] = useState<EditState | null>(null);
    const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
    const [selectionAnchor, setSelectionAnchor] = useState<CellCoord | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const lastEditCellRef = useRef<CellCoord | null>(null);
    const tableRef = useRef<HTMLDivElement>(null);

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

    // Clear selection when symbol changes
    useEffect(() => {
        setSelectedCells(new Set());
        setSelectionAnchor(null);
        setEditCell(null);
    }, [symbol]);

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

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only handle if table is focused (or child is focused)
            if (!tableRef.current?.contains(document.activeElement) && document.activeElement !== document.body) {
                return;
            }

            if (e.key === 'Escape') {
                setSelectedCells(new Set());
                setSelectionAnchor(null);
                setEditCell(null);
            }

            if (e.ctrlKey && e.key === 'a') {
                e.preventDefault();
                // Select all cells
                const allCells = new Set<string>();
                for (let yi = 0; yi < y.length; yi++) {
                    for (let xi = 0; xi < x.length; xi++) {
                        allCells.add(`${xi},${yi}`);
                    }
                }
                setSelectedCells(allCells);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [x.length, y.length]);

    // Mouse up handler for drag selection
    useEffect(() => {
        const handleMouseUp = () => {
            setIsDragging(false);
        };
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

    // Get range of cells between two points
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
            // Ctrl+click: Toggle selection
            const newSelection = new Set(selectedCells);
            if (newSelection.has(key)) {
                newSelection.delete(key);
            } else {
                newSelection.add(key);
            }
            setSelectedCells(newSelection);
            setSelectionAnchor({ x: xIdx, y: yIdx });
        } else if (e.shiftKey && selectionAnchor) {
            // Shift+click: Range selection
            const range = getCellsInRange(selectionAnchor, { x: xIdx, y: yIdx });
            setSelectedCells(range);
        } else {
            // Regular click: Start new selection or edit
            if (selectedCells.size <= 1 && !selectedCells.has(key)) {
                // Single click without existing multi-selection - start fresh
                setSelectedCells(new Set([key]));
                setSelectionAnchor({ x: xIdx, y: yIdx });
                setIsDragging(true);
            } else if (selectedCells.has(key) && selectedCells.size === 1) {
                // Double-click behavior: Edit cell if already selected
                const rawValue = z[yIdx]?.[xIdx] ?? 0;
                const formatted = formatValue(rawValue, symbol.correction, symbol.offset);
                setEditCell({ xIndex: xIdx, yIndex: yIdx, value: formatted });
            } else {
                // Click on selected cell in multi-selection or click to start new selection
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

    const formatValue = (val: number, factor: number, offset: number, isAxis: boolean = false, units?: string) => {
        const f = factor !== undefined ? factor : 1;
        const o = offset !== undefined ? offset : 0;
        const real = val * f + o;
        const formatted = parseFloat(real.toFixed(3)).toString();

        // Append unit symbol for axis values if units are provided
        if (isAxis && units) {
            // Extract short unit symbol
            const unitLower = units.toLowerCase();
            if (unitLower.includes('°c') || unitLower.includes('degc') || unitLower.includes('celcius') || unitLower.includes('celsius')) {
                return `${formatted}°C`;
            } else if (unitLower.includes('%') || unitLower.includes('percent')) {
                return `${formatted}%`;
            } else if (unitLower.includes('°') || unitLower.includes('deg') || unitLower.includes('btdc')) {
                return `${formatted}°`;
            } else if (units.trim() && !unitLower.includes('rpm') && !unitLower.includes('mbar') && !unitLower.includes('mg')) {
                // For other units, just append the unit text if it's short
                return formatted;
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

    if (!symbol || !fileBuffer) return <div className="p-6 text-zinc-500 text-center">No map data available.</div>;

    const hasSelection = selectedCells.size > 0 && !editCell;

    return (
        <div ref={tableRef} className="flex flex-col h-full w-full overflow-hidden bg-zinc-950 text-zinc-300 text-xs font-mono" tabIndex={0}>
            {/* Header Info */}
            <div className="flex-shrink-0 px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex justify-between items-end">
                <div>
                    <h3 className="font-bold text-base text-zinc-100 tracking-tight">{symbol.varname || "Unnamed Map"}</h3>
                    <div className="flex gap-4 text-zinc-500 mt-1 text-[11px]">
                        <span>ID: <span className="text-zinc-400 font-mono">0x{symbol.flashStartAddress.toString(16).toUpperCase()}</span></span>
                        <span>Size: <span className="text-zinc-400">{symbol.xAxisLength}x{symbol.yAxisLength}</span></span>
                        <span>Factor: <span className="text-zinc-400">{symbol.correction}</span></span>
                    </div>
                </div>
                <div className="text-right text-zinc-500 text-[10px]">
                    {/* C# only swaps ADDRESSES, NOT descriptions/units/corrections. X display uses xAxis info, Y uses yAxis info */}
                    <div>X: {symbol.xAxisDescr}{symbol.xaxisUnits && !symbol.xAxisDescr?.toLowerCase().includes(symbol.xaxisUnits.toLowerCase().replace(/[^a-z°%]/gi, '')) ? ` (${symbol.xaxisUnits})` : ''}</div>
                    <div>Y: {symbol.yAxisDescr}{symbol.yaxisUnits && !symbol.yAxisDescr?.toLowerCase().includes(symbol.yaxisUnits.toLowerCase().replace(/[^a-z°%]/gi, '')) ? ` (${symbol.yaxisUnits})` : ''}</div>
                    <div>Z: {symbol.zAxisDescr || "Value"}</div>
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
            <div className="flex-1 overflow-auto relative custom-scrollbar">
                <table className="w-max border-separate border-spacing-0">
                    <thead className="sticky top-0 z-20 shadow-sm">
                        <tr>
                            <th className="sticky left-0 z-30 p-2 min-w-[60px] bg-zinc-900 border-r border-b border-zinc-800 text-zinc-500 font-normal text-[10px] uppercase tracking-wider">
                                Y \ X
                            </th>
                            {x.map((val, idx) => (
                                <th key={`x-${idx}`} className="p-2 min-w-[60px] bg-zinc-900 border-b border-r border-zinc-800 text-zinc-400 font-medium">
                                    {formatValue(val, symbol.xAxisCorrection, symbol.xAxisOffset, true, symbol.xaxisUnits)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {y.map((yVal, yIdx) => (
                            <tr key={`y-${yIdx}`} className="group">
                                <th className="sticky left-0 z-10 p-2 bg-zinc-900 border-r border-b border-zinc-800 text-zinc-400 font-medium group-hover:bg-zinc-800 transition-colors">
                                    {formatValue(yVal, symbol.yAxisCorrection, symbol.yAxisOffset, true, symbol.yaxisUnits)}
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
                                                p-0 border-r border-b min-w-[60px] relative select-none
                                                ${!isEditing ? 'cursor-pointer transition-colors opacity-90 hover:opacity-100' : ''}
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
                                                    className="absolute inset-0 w-full h-full bg-zinc-800 text-zinc-100 text-center outline-none border-2 border-blue-500 font-mono text-xs"
                                                    value={editCell.value}
                                                    onChange={(e) => setEditCell({ ...editCell, value: e.target.value })}
                                                    onBlur={handleSave}
                                                    onKeyDown={handleKeyDown}
                                                />
                                            ) : (
                                                <div className="py-2 px-1 text-center font-medium">
                                                    {formatValue(zVal, symbol.correction, symbol.offset)}
                                                    {isPercentMap && <span className="opacity-50 text-[10px] ml-0.5">%</span>}
                                                    {isDegreeMap && <span className="opacity-50 text-[10px] ml-0.5">°</span>}
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
        </div>
    );
};
