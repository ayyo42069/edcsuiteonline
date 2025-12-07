import React, { useMemo, useState, useEffect, useRef } from 'react';
import { SymbolHelper } from '../core/types';
import { Tools } from '../core/tools';
import { useFileStore } from '../store/useFileStore';
import { getColorForValue, getTextColorForBackground } from '../utils/colorUtils';

interface MapTableProps {
    symbol: SymbolHelper;
    fileBuffer: ArrayBuffer;
}

interface EditState {
    xIndex: number;
    yIndex: number;
    value: string;
}

export const MapTable: React.FC<MapTableProps> = ({ symbol, fileBuffer }) => {
    const updateMapData = useFileStore(state => state.updateMapData);
    const [editCell, setEditCell] = useState<EditState | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
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

        // Calculate Real Min/Max
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

    const formatValue = (val: number, factor: number, offset: number, isAxis: boolean = false) => {
        const f = factor !== undefined ? factor : 1;
        const o = offset !== undefined ? offset : 0;
        const real = val * f + o;
        const str = parseFloat(real.toFixed(3)).toString();
        return str;
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

    if (!symbol || !fileBuffer) return <div className="p-6 text-zinc-500 text-center">No map data available.</div>;

    return (
        <div className="flex flex-col h-full w-full overflow-hidden bg-zinc-950 text-zinc-300 text-xs font-mono">
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
                    <div>X: {symbol.xAxisDescr} ({symbol.xaxisUnits})</div>
                    <div>Y: {symbol.yAxisDescr} ({symbol.yaxisUnits})</div>
                    <div>Z: {symbol.zAxisDescr || "Value"}</div>
                </div>
            </div>

            {/* Data Grid */}
            <div className="flex-1 overflow-auto relative custom-scrollbar">
                <table className="w-max border-separate border-spacing-0">
                    <thead className="sticky top-0 z-20 shadow-sm">
                        <tr>
                            {/* Corner Cell */}
                            <th className="sticky left-0 z-30 p-2 min-w-[60px] bg-zinc-900 border-r border-b border-zinc-800 text-zinc-500 font-normal text-[10px] uppercase tracking-wider">
                                Y \ X
                            </th>
                            {/* X Axis Headers - data from yAxisAddress, use yAxisCorrection */}
                            {x.map((val, idx) => (
                                <th key={`x-${idx}`} className="p-2 min-w-[60px] bg-zinc-900 border-b border-r border-zinc-800 text-zinc-400 font-medium">
                                    {formatValue(val, symbol.yAxisCorrection, symbol.yAxisOffset, true)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {y.map((yVal, yIdx) => (
                            <tr key={`y-${yIdx}`} className="group">
                                {/* Y Axis Header (Sticky Left) - data from xAxisAddress, use xAxisCorrection */}
                                <th className="sticky left-0 z-10 p-2 bg-zinc-900 border-r border-b border-zinc-800 text-zinc-400 font-medium group-hover:bg-zinc-800 transition-colors">
                                    {formatValue(yVal, symbol.xAxisCorrection, symbol.xAxisOffset, true)}
                                </th>

                                {/* Z Data Cells */}
                                {z[yIdx]?.map((zVal, xIdx) => {
                                    const isEditing = editCell?.xIndex === xIdx && editCell?.yIndex === yIdx;

                                    const realVal = zVal * (symbol.correction || 1) + (symbol.offset || 0);

                                    // Heatmap logic: Use fixed 0-100 range for % maps, otherwise relative
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
                                                p-0 border-r border-b border-zinc-800/50 min-w-[60px] relative
                                                ${!isEditing ? 'cursor-pointer transition-colors opacity-90 hover:opacity-100' : ''}
                                                ${isEditing ? 'bg-zinc-800' : ''}
                                            `}
                                            onClick={() => !isEditing && handleCellClick(xIdx, yIdx, zVal)}
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
