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
            {/* Compact single-line header. The axis legend uses small colour chips
                instead of a separate block — saves a row of vertical space, which
                matters more than the prettier two-line layout on small screens. */}
            <div className="flex-shrink-0 px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 flex justify-between items-center gap-3 text-[11px]">
                <div className="min-w-0 flex-1 flex items-center gap-2">
                    <h3 className="font-bold text-zinc-100 truncate" title={symbol.varname}>
                        {symbol.varname || "Unnamed Map"}
                    </h3>
                    <span className="text-zinc-600 font-mono">0x{symbol.flashStartAddress.toString(16).toUpperCase()}</span>
                    <span className="text-zinc-600">·</span>
                    <span className="text-zinc-500">{symbol.xAxisLength}×{symbol.yAxisLength}</span>
                    <span className="text-zinc-600">·</span>
                    <span className="text-zinc-500">×{symbol.correction}</span>
                </div>
                <div className="hidden sm:flex items-center gap-2 text-zinc-500 shrink-0 max-w-[60%] overflow-hidden">
                    <span className="truncate" title={`${symbol.xAxisDescr ?? ''} ${symbol.xaxisUnits ? `(${symbol.xaxisUnits})` : ''}`}>
                        <span className="text-blue-400 font-semibold">X</span>&nbsp;{symbol.xAxisDescr || "—"}
                        {symbol.xaxisUnits ? <span className="text-zinc-600"> ({symbol.xaxisUnits})</span> : null}
                    </span>
                    <span className="text-zinc-700">/</span>
                    <span className="truncate" title={`${symbol.yAxisDescr ?? ''} ${symbol.yaxisUnits ? `(${symbol.yaxisUnits})` : ''}`}>
                        <span className="text-green-400 font-semibold">Y</span>&nbsp;{symbol.yAxisDescr || "—"}
                        {symbol.yaxisUnits ? <span className="text-zinc-600"> ({symbol.yaxisUnits})</span> : null}
                    </span>
                    <span className="text-zinc-700">/</span>
                    <span className="truncate">
                        <span className="text-purple-400 font-semibold">Z</span>&nbsp;{symbol.zAxisDescr || "Value"}
                    </span>
                </div>
            </div>

            <MapEditor symbol={symbol} fileBuffer={fileBuffer} dense />
        </div>
    );
};
