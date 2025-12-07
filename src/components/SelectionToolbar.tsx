import React, { useState } from 'react';
import { X, Percent, Plus, Minus, Equal, XIcon } from 'lucide-react';

interface SelectionToolbarProps {
    selectedCount: number;
    onApply: (operation: 'set' | 'add' | 'multiply' | 'addPercent', value: number) => void;
    onClear: () => void;
}

type OperationMode = 'set' | 'add' | 'multiply' | 'percent';

export const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
    selectedCount,
    onApply,
    onClear
}) => {
    const [mode, setMode] = useState<OperationMode>('add');
    const [inputValue, setInputValue] = useState('');

    const handleApply = () => {
        const num = parseFloat(inputValue);
        if (isNaN(num)) return;

        switch (mode) {
            case 'set':
                onApply('set', num);
                break;
            case 'add':
                onApply('add', num);
                break;
            case 'multiply':
                onApply('multiply', num);
                break;
            case 'percent':
                onApply('addPercent', num);
                break;
        }
        setInputValue('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleApply();
        }
    };

    // Quick actions
    const quickActions = [
        { label: '+5', op: 'add' as const, val: 5 },
        { label: '-5', op: 'add' as const, val: -5 },
        { label: '+10%', op: 'addPercent' as const, val: 10 },
        { label: '-10%', op: 'addPercent' as const, val: -10 },
        { label: '×1.1', op: 'multiply' as const, val: 1.1 },
        { label: '×0.9', op: 'multiply' as const, val: 0.9 },
    ];

    return (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-600/20 border-b border-blue-500/30 text-sm">
            {/* Selection info */}
            <div className="flex items-center gap-2 text-blue-300 font-medium">
                <span className="px-2 py-0.5 rounded bg-blue-600 text-white text-xs font-bold">
                    {selectedCount}
                </span>
                <span>cell{selectedCount !== 1 ? 's' : ''} selected</span>
            </div>

            <div className="h-4 w-px bg-zinc-600 mx-2" />

            {/* Quick actions */}
            <div className="flex gap-1">
                {quickActions.map((action) => (
                    <button
                        key={action.label}
                        onClick={() => onApply(action.op, action.val)}
                        className="px-2 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors border border-zinc-700"
                    >
                        {action.label}
                    </button>
                ))}
            </div>

            <div className="h-4 w-px bg-zinc-600 mx-2" />

            {/* Custom operation */}
            <div className="flex items-center gap-1">
                <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as OperationMode)}
                    className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 outline-none focus:border-blue-500"
                >
                    <option value="set">Set to</option>
                    <option value="add">Add</option>
                    <option value="multiply">Multiply by</option>
                    <option value="percent">Add %</option>
                </select>
                <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={mode === 'multiply' ? '1.0' : '0'}
                    className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-blue-500 font-mono"
                />
                <button
                    onClick={handleApply}
                    disabled={!inputValue}
                    className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium transition-colors"
                >
                    Apply
                </button>
            </div>

            {/* Clear selection */}
            <button
                onClick={onClear}
                className="ml-auto p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                title="Clear selection (Esc)"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
};
