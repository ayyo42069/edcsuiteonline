import React, { useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';

interface HexViewerProps {
    data: Uint8Array;
}

const ROW_SIZE = 16;

export const HexViewer: React.FC<HexViewerProps> = ({ data }) => {
    const rowCount = Math.ceil(data.length / ROW_SIZE);

    const itemContent = (index: number) => {
        const offset = index * ROW_SIZE;
        const rowData = data.subarray(offset, Math.min(offset + ROW_SIZE, data.length));
        
        // Address
        const address = offset.toString(16).toUpperCase().padStart(8, '0');

        // Hex
        const hexBytes = [];
        for (let i = 0; i < ROW_SIZE; i++) {
            if (i < rowData.length) {
                hexBytes.push(rowData[i].toString(16).toUpperCase().padStart(2, '0'));
            } else {
                hexBytes.push("  ");
            }
        }

        // ASCII
        const asciiChars = [];
        for (let i = 0; i < ROW_SIZE; i++) {
            if (i < rowData.length) {
                const charCode = rowData[i];
                // Printable ASCII range (roughly)
                if (charCode >= 32 && charCode <= 126) {
                    asciiChars.push(String.fromCharCode(charCode));
                } else {
                    asciiChars.push(".");
                }
            } else {
                asciiChars.push(" ");
            }
        }

        return (
            <div className="flex font-mono text-sm hover:bg-gray-100 dark:hover:bg-gray-800 cursor-default h-[24px] items-center">
                {/* Address */}
                <div className="w-24 text-blue-600 dark:text-blue-400 select-none border-r border-gray-200 dark:border-gray-700 px-2">
                    {address}
                </div>
                
                {/* Hex Bytes */}
                <div className="flex-1 flex px-4 space-x-2 text-gray-800 dark:text-gray-200">
                    <div className="flex space-x-1">
                        {hexBytes.slice(0, 8).map((byte, idx) => (
                            <span key={`l-${idx}`} className={byte === "  " ? "invisible" : ""}>{byte}</span>
                        ))}
                    </div>
                    <div className="w-4"></div>
                    <div className="flex space-x-1">
                        {hexBytes.slice(8, 16).map((byte, idx) => (
                            <span key={`r-${idx}`} className={byte === "  " ? "invisible" : ""}>{byte}</span>
                        ))}
                    </div>
                </div>

                {/* ASCII */}
                <div className="w-48 border-l border-gray-200 dark:border-gray-700 px-2 text-gray-600 dark:text-gray-400 tracking-widest">
                    {asciiChars.join("")}
                </div>
            </div>
        );
    };

    return (
        <div className="h-full w-full bg-white dark:bg-gray-900">
            <Virtuoso
                totalCount={rowCount}
                itemContent={itemContent}
                className="scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600"
                style={{ height: '100%', width: '100%' }}
            />
        </div>
    );
};