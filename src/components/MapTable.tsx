import React from 'react';
import { SymbolHelper } from '../core/types';
import { MapEditor } from './MapEditor';

interface MapTableProps {
    symbol: SymbolHelper;
    fileBuffer: ArrayBuffer;
}

// Thin wrapper around the unified MapEditor for the inline view.
// All editing logic, keyboard shortcuts and selection state live in MapEditor.
export const MapTable: React.FC<MapTableProps> = ({ symbol, fileBuffer }) => {
    return (
        <div className="flex flex-col h-full w-full bg-zinc-950 text-zinc-300 font-mono">
            {/* Header strip — shows symbol identity & axis legend */}
            <div className="flex-shrink-0 px-4 py-2.5 bg-zinc-900 border-b border-zinc-800 flex justify-between items-center gap-4">
                <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-sm text-zinc-100 tracking-tight truncate">
                        {symbol.varname || "Unnamed Map"}
                    </h3>
                    <div className="flex gap-3 text-zinc-500 mt-0.5 text-[10px]">
                        <span>0x{symbol.flashStartAddress.toString(16).toUpperCase()}</span>
                        <span>·</span>
                        <span>{symbol.xAxisLength}×{symbol.yAxisLength}</span>
                        <span>·</span>
                        <span>factor {symbol.correction}</span>
                    </div>
                </div>
                <div className="text-right text-[10px] text-zinc-500 shrink-0">
                    <div>
                        <span className="text-blue-400 font-semibold">X </span>
                        {symbol.xAxisDescr || "X axis"}
                        {symbol.xaxisUnits ? ` (${symbol.xaxisUnits})` : ''}
                    </div>
                    <div>
                        <span className="text-green-400 font-semibold">Y </span>
                        {symbol.yAxisDescr || "Y axis"}
                        {symbol.yaxisUnits ? ` (${symbol.yaxisUnits})` : ''}
                    </div>
                    <div>
                        <span className="text-purple-400 font-semibold">Z </span>
                        {symbol.zAxisDescr || "Value"}
                    </div>
                </div>
            </div>

            <MapEditor symbol={symbol} fileBuffer={fileBuffer} dense />
        </div>
    );
};
