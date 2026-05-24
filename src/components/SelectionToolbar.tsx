import React, { useState } from 'react';
import { X, Copy, ClipboardPaste, Wand2, MoveHorizontal, MoveVertical } from 'lucide-react';

interface SelectionToolbarProps {
    selectedCount: number;
    // Live stats over the current selection, post-correction.
    stats: { min: number; max: number; avg: number; sum: number } | null;
    onApply: (operation: 'set' | 'add' | 'multiply' | 'addPercent', value: number) => void;
    onSmooth: () => void;
    onInterpolateX: () => void;
    onInterpolateY: () => void;
    onCopy: () => void;
    onPaste: () => void;
    canPaste: boolean;
    onClear: () => void;
}

type OperationMode = 'set' | 'add' | 'multiply' | 'percent';

const fmt = (n: number) => {
    if (!isFinite(n)) return '–';
    const abs = Math.abs(n);
    if (abs >= 1000) return n.toFixed(0);
    if (abs >= 10) return n.toFixed(1);
    return n.toFixed(2);
};

export const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
    selectedCount,
    stats,
    onApply,
    onSmooth,
    onInterpolateX,
    onInterpolateY,
    onCopy,
    onPaste,
    canPaste,
    onClear
}) => {
    const [mode, setMode] = useState<OperationMode>('add');
    const [inputValue, setInputValue] = useState('');

    const handleApply = () => {
        const num = parseFloat(inputValue);
        if (isNaN(num)) return;
        const opMap: Record<OperationMode, 'set' | 'add' | 'multiply' | 'addPercent'> = {
            set: 'set', add: 'add', multiply: 'multiply', percent: 'addPercent'
        };
        onApply(opMap[mode], num);
        setInputValue('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') { e.preventDefault(); handleApply(); }
        // Don't let the editor's global shortcuts steal the input.
        e.stopPropagation();
    };

    // Two rows: top = stats + quick ops, bottom = custom op + actions. Keeps each row scannable.
    return (
        <div className="flex flex-col gap-1.5 px-3 py-2 bg-blue-950/30 border-y border-blue-500/30 text-xs">
            {/* Row 1: count + live stats + quick deltas */}
            <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-blue-200 font-medium">
                    <span className="px-1.5 py-0.5 rounded bg-blue-600 text-white text-[10px] font-bold tabular-nums">
                        {selectedCount}
                    </span>
                    <span className="text-blue-300/80">selected</span>
                </div>

                {stats && (
                    <div className="flex items-center gap-3 text-zinc-400 font-mono tabular-nums">
                        <span><span className="text-zinc-500">min</span> <span className="text-zinc-200">{fmt(stats.min)}</span></span>
                        <span><span className="text-zinc-500">max</span> <span className="text-zinc-200">{fmt(stats.max)}</span></span>
                        <span><span className="text-zinc-500">avg</span> <span className="text-zinc-200">{fmt(stats.avg)}</span></span>
                        <span><span className="text-zinc-500">sum</span> <span className="text-zinc-200">{fmt(stats.sum)}</span></span>
                    </div>
                )}

                <div className="h-4 w-px bg-blue-500/20" />

                {/* Quick deltas — most common adjustments */}
                <div className="flex gap-0.5">
                    {[
                        { label: '+1', op: 'add' as const, val: 1 },
                        { label: '+5', op: 'add' as const, val: 5 },
                        { label: '+10', op: 'add' as const, val: 10 },
                        { label: '−1', op: 'add' as const, val: -1 },
                        { label: '−5', op: 'add' as const, val: -5 },
                    ].map(a => (
                        <button
                            key={a.label}
                            onClick={() => onApply(a.op, a.val)}
                            className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors font-mono tabular-nums"
                            title={`${a.op} ${a.val}`}
                        >
                            {a.label}
                        </button>
                    ))}
                    <span className="w-1" />
                    {[
                        { label: '+5%', op: 'addPercent' as const, val: 5 },
                        { label: '+10%', op: 'addPercent' as const, val: 10 },
                        { label: '−5%', op: 'addPercent' as const, val: -5 },
                        { label: '−10%', op: 'addPercent' as const, val: -10 },
                    ].map(a => (
                        <button
                            key={a.label}
                            onClick={() => onApply(a.op, a.val)}
                            className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors font-mono tabular-nums"
                            title={`add ${a.val}%`}
                        >
                            {a.label}
                        </button>
                    ))}
                </div>

                <button
                    onClick={onClear}
                    className="ml-auto p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                    title="Clear selection (Esc)"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Row 2: custom op + smoothing/interp + clipboard */}
            <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1">
                    <select
                        value={mode}
                        onChange={(e) => setMode(e.target.value as OperationMode)}
                        className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-300 outline-none focus:border-blue-500"
                    >
                        <option value="set">Set to</option>
                        <option value="add">Add</option>
                        <option value="multiply">×</option>
                        <option value="percent">+ %</option>
                    </select>
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={mode === 'multiply' ? '1.0' : '0'}
                        className="w-20 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-100 outline-none focus:border-blue-500 font-mono"
                    />
                    <button
                        onClick={handleApply}
                        disabled={!inputValue}
                        className="px-2.5 py-0.5 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium transition-colors"
                    >
                        Apply
                    </button>
                </div>

                <div className="h-4 w-px bg-blue-500/20" />

                {/* Shape ops */}
                <button
                    onClick={onSmooth}
                    disabled={selectedCount < 4}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-600 text-zinc-300 hover:text-white transition-colors"
                    title="Smooth: average each selected cell with its 4 neighbors (only changes the selection)"
                >
                    <Wand2 className="w-3 h-3" /> Smooth
                </button>
                <button
                    onClick={onInterpolateX}
                    disabled={selectedCount < 2}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-600 text-zinc-300 hover:text-white transition-colors"
                    title="Linear interpolate selection along the X axis (left→right)"
                >
                    <MoveHorizontal className="w-3 h-3" /> Interp X
                </button>
                <button
                    onClick={onInterpolateY}
                    disabled={selectedCount < 2}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-600 text-zinc-300 hover:text-white transition-colors"
                    title="Linear interpolate selection along the Y axis (top→bottom)"
                >
                    <MoveVertical className="w-3 h-3" /> Interp Y
                </button>

                <div className="h-4 w-px bg-blue-500/20" />

                <button
                    onClick={onCopy}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors"
                    title="Copy selection (Ctrl+C)"
                >
                    <Copy className="w-3 h-3" /> Copy
                </button>
                <button
                    onClick={onPaste}
                    disabled={!canPaste}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-600 text-zinc-300 hover:text-white transition-colors"
                    title="Paste at selection top-left (Ctrl+V)"
                >
                    <ClipboardPaste className="w-3 h-3" /> Paste
                </button>
            </div>
        </div>
    );
};
