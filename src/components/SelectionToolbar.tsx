import React, { useState } from 'react';
import { X, Copy, ClipboardPaste, Wand2, MoveHorizontal, MoveVertical, ChevronDown, MoreHorizontal } from 'lucide-react';

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

const QUICK_DELTAS = [
    { label: '+1', op: 'add' as const, val: 1 },
    { label: '+5', op: 'add' as const, val: 5 },
    { label: '+10', op: 'add' as const, val: 10 },
    { label: '−1', op: 'add' as const, val: -1 },
    { label: '−5', op: 'add' as const, val: -5 },
    { label: '−10', op: 'add' as const, val: -10 },
];
const QUICK_PERCENTS = [
    { label: '+5%', op: 'addPercent' as const, val: 5 },
    { label: '+10%', op: 'addPercent' as const, val: 10 },
    { label: '−5%', op: 'addPercent' as const, val: -5 },
    { label: '−10%', op: 'addPercent' as const, val: -10 },
];

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
    // On small screens the extras fold into a "More" popover so the toolbar fits
    // one row. Toggled by the chevron button visible only at sm breakpoint.
    const [moreOpen, setMoreOpen] = useState(false);

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

    return (
        <div className="bg-blue-950/30 border-y border-blue-500/30 text-[11px]">
            {/* Compact single row. Items wrap to a second row only if the viewport
                is too narrow to fit them all — which is rare since we keep things tight. */}
            <div className="flex items-center gap-1.5 px-2 py-1 flex-wrap">
                {/* Selection count */}
                <div className="flex items-center gap-1.5 text-blue-200 font-medium">
                    <span className="px-1 py-0 rounded bg-blue-600 text-white text-[10px] font-bold tabular-nums leading-tight">
                        {selectedCount}
                    </span>
                </div>

                {/* Stats — collapse labels on narrow viewports */}
                {stats && (
                    <div className="hidden sm:flex items-center gap-2 text-zinc-400 font-mono tabular-nums">
                        <span><span className="text-zinc-500">min</span> <span className="text-zinc-200">{fmt(stats.min)}</span></span>
                        <span><span className="text-zinc-500">max</span> <span className="text-zinc-200">{fmt(stats.max)}</span></span>
                        <span><span className="text-zinc-500">avg</span> <span className="text-zinc-200">{fmt(stats.avg)}</span></span>
                    </div>
                )}
                {stats && (
                    <div className="sm:hidden flex items-center gap-1.5 text-zinc-400 font-mono tabular-nums" title={`min ${fmt(stats.min)} / max ${fmt(stats.max)} / avg ${fmt(stats.avg)} / sum ${fmt(stats.sum)}`}>
                        <span className="text-zinc-200">{fmt(stats.min)}</span>
                        <span className="text-zinc-600">…</span>
                        <span className="text-zinc-200">{fmt(stats.max)}</span>
                    </div>
                )}

                <span className="h-3 w-px bg-blue-500/20" />

                {/* Custom op (always visible — the primary action) */}
                <div className="flex items-center gap-1">
                    <select
                        value={mode}
                        onChange={(e) => setMode(e.target.value as OperationMode)}
                        className="bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-zinc-300 outline-none focus:border-blue-500 text-[11px]"
                    >
                        <option value="set">Set</option>
                        <option value="add">+/−</option>
                        <option value="multiply">×</option>
                        <option value="percent">%</option>
                    </select>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={mode === 'multiply' ? '1.0' : '0'}
                        className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-100 outline-none focus:border-blue-500 font-mono text-[11px]"
                    />
                    <button
                        onClick={handleApply}
                        disabled={!inputValue}
                        className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-medium transition-colors text-[11px]"
                    >
                        Apply
                    </button>
                </div>

                {/* Quick deltas — visible on md+ */}
                <div className="hidden md:flex gap-0.5 ml-1">
                    {QUICK_DELTAS.slice(0, 4).map(a => (
                        <button
                            key={a.label}
                            onClick={() => onApply(a.op, a.val)}
                            className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors font-mono tabular-nums text-[11px]"
                            title={`${a.op} ${a.val}`}
                        >
                            {a.label}
                        </button>
                    ))}
                </div>

                {/* Shape ops icons */}
                <div className="hidden md:flex items-center gap-0.5 ml-1">
                    <button
                        onClick={onSmooth}
                        disabled={selectedCount < 4}
                        className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-700 text-zinc-300 hover:text-white transition-colors"
                        title="Smooth (4-neighbour average)"
                    >
                        <Wand2 className="w-3 h-3" />
                    </button>
                    <button
                        onClick={onInterpolateX}
                        disabled={selectedCount < 2}
                        className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-700 text-zinc-300 hover:text-white transition-colors"
                        title="Interpolate along X"
                    >
                        <MoveHorizontal className="w-3 h-3" />
                    </button>
                    <button
                        onClick={onInterpolateY}
                        disabled={selectedCount < 2}
                        className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-700 text-zinc-300 hover:text-white transition-colors"
                        title="Interpolate along Y"
                    >
                        <MoveVertical className="w-3 h-3" />
                    </button>
                </div>

                {/* Clipboard */}
                <div className="hidden md:flex items-center gap-0.5 ml-1">
                    <button
                        onClick={onCopy}
                        className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors"
                        title="Copy (Ctrl+C)"
                    >
                        <Copy className="w-3 h-3" />
                    </button>
                    <button
                        onClick={onPaste}
                        disabled={!canPaste}
                        className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-700 text-zinc-300 hover:text-white transition-colors"
                        title="Paste (Ctrl+V)"
                    >
                        <ClipboardPaste className="w-3 h-3" />
                    </button>
                </div>

                {/* "More" toggle: small screens get everything via dropdown */}
                <div className="md:hidden relative">
                    <button
                        onClick={() => setMoreOpen(v => !v)}
                        className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors flex items-center gap-1"
                        title="More options"
                    >
                        <MoreHorizontal className="w-3 h-3" />
                        <ChevronDown className={`w-3 h-3 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {moreOpen && (
                        <div className="absolute top-full right-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-md shadow-xl p-2 z-50 min-w-[180px]">
                            <div className="text-[10px] uppercase tracking-wider text-zinc-500 px-1 mb-1">Quick deltas</div>
                            <div className="grid grid-cols-3 gap-1 mb-2">
                                {QUICK_DELTAS.map(a => (
                                    <button
                                        key={a.label}
                                        onClick={() => { onApply(a.op, a.val); setMoreOpen(false); }}
                                        className="px-1.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-mono"
                                    >
                                        {a.label}
                                    </button>
                                ))}
                            </div>
                            <div className="text-[10px] uppercase tracking-wider text-zinc-500 px-1 mb-1">Percent</div>
                            <div className="grid grid-cols-2 gap-1 mb-2">
                                {QUICK_PERCENTS.map(a => (
                                    <button
                                        key={a.label}
                                        onClick={() => { onApply(a.op, a.val); setMoreOpen(false); }}
                                        className="px-1.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-mono"
                                    >
                                        {a.label}
                                    </button>
                                ))}
                            </div>
                            <div className="text-[10px] uppercase tracking-wider text-zinc-500 px-1 mb-1">Shape</div>
                            <div className="grid grid-cols-3 gap-1 mb-2">
                                <button
                                    onClick={() => { onSmooth(); setMoreOpen(false); }}
                                    disabled={selectedCount < 4}
                                    className="flex items-center justify-center gap-1 px-1.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 text-[11px]"
                                    title="Smooth"
                                >
                                    <Wand2 className="w-3 h-3" />
                                </button>
                                <button
                                    onClick={() => { onInterpolateX(); setMoreOpen(false); }}
                                    disabled={selectedCount < 2}
                                    className="flex items-center justify-center gap-1 px-1.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 text-[11px]"
                                    title="Interp X"
                                >
                                    <MoveHorizontal className="w-3 h-3" />
                                </button>
                                <button
                                    onClick={() => { onInterpolateY(); setMoreOpen(false); }}
                                    disabled={selectedCount < 2}
                                    className="flex items-center justify-center gap-1 px-1.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 text-[11px]"
                                    title="Interp Y"
                                >
                                    <MoveVertical className="w-3 h-3" />
                                </button>
                            </div>
                            <div className="text-[10px] uppercase tracking-wider text-zinc-500 px-1 mb-1">Clipboard</div>
                            <div className="grid grid-cols-2 gap-1">
                                <button
                                    onClick={() => { onCopy(); setMoreOpen(false); }}
                                    className="flex items-center justify-center gap-1 px-1.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px]"
                                >
                                    <Copy className="w-3 h-3" /> Copy
                                </button>
                                <button
                                    onClick={() => { onPaste(); setMoreOpen(false); }}
                                    disabled={!canPaste}
                                    className="flex items-center justify-center gap-1 px-1.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 text-[11px]"
                                >
                                    <ClipboardPaste className="w-3 h-3" /> Paste
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <button
                    onClick={onClear}
                    className="ml-auto p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                    title="Clear selection (Esc)"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
};
