"use client";

import React, { useEffect, useState } from "react";
import { useFileStore } from "@/src/store/useFileStore";
import { EDC15P_checksum, ChecksumResult } from "@/src/core/checksum/EDC15P_checksum";
import { EDC15VM_checksum } from "@/src/core/checksum/EDC15VM_checksum";
import { EDCFileType } from "@/src/core/types";

// Checksum type enum matching C# ChecksumType
enum ChecksumType {
    VAG_EDC15P_V41 = "VAG EDC15P v4.1",
    VAG_EDC15P_V41V2 = "VAG EDC15P v4.1 V2",
    VAG_EDC15P_V41_2002 = "VAG EDC15P v4.1 (2002)",
    VAG_EDC15VM_V41 = "VAG EDC15VM v4.1",
    VAG_EDC15VM_V41V2 = "VAG EDC15VM v4.1 V2",
    VAG_EDC15VM_V41_2002 = "VAG EDC15VM v4.1 (2002)",
    Unknown = "Unknown"
}

interface ChecksumDetails {
    checksumType: ChecksumType;
    result: ChecksumResult;
    totalChecksums: number;
    checksumsOk: number;
    checksumsFailed: number;
    checked: boolean;
}

interface ChecksumModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ChecksumModal({ isOpen, onClose }: ChecksumModalProps) {
    const fileBuffer = useFileStore((state) => state.fileBuffer);
    const fileType = useFileStore((state) => state.fileType);
    const fileName = useFileStore((state) => state.fileName);

    const [details, setDetails] = useState<ChecksumDetails>({
        checksumType: ChecksumType.Unknown,
        result: ChecksumResult.ChecksumFail,
        totalChecksums: 0,
        checksumsOk: 0,
        checksumsFailed: 0,
        checked: false
    });
    const [isVerifying, setIsVerifying] = useState(false);
    const [isFixed, setIsFixed] = useState(false);
    const [workingBuffer, setWorkingBuffer] = useState<Uint8Array | null>(null);

    useEffect(() => {
        if (isOpen && fileBuffer) {
            // Clone buffer for working copy
            setWorkingBuffer(new Uint8Array(fileBuffer.slice(0)));
            setDetails({
                checksumType: ChecksumType.Unknown,
                result: ChecksumResult.ChecksumFail,
                totalChecksums: 0,
                checksumsOk: 0,
                checksumsFailed: 0,
                checked: false
            });
            setIsFixed(false);
        }
    }, [isOpen, fileBuffer]);

    const determineChecksumClass = (): { checksum: EDC15P_checksum | EDC15VM_checksum, isVM: boolean } => {
        // Use EDC15VM checksum for V/M/C variants, EDC15P for P variants
        const isVM = [EDCFileType.EDC15V, EDCFileType.EDC15M, EDCFileType.EDC15C].includes(fileType);
        if (isVM) {
            return { checksum: new EDC15VM_checksum(), isVM: true };
        }
        return { checksum: new EDC15P_checksum(), isVM: false };
    };

    const handleVerify = () => {
        if (!workingBuffer) return;
        setIsVerifying(true);

        setTimeout(() => {
            const { checksum, isVM } = determineChecksumClass();
            let result = ChecksumResult.ChecksumFail;
            let detectedType = ChecksumType.Unknown;

            // Try standard search first
            result = checksum.tdi41_checksum_search(workingBuffer, workingBuffer.length);
            if (result === ChecksumResult.ChecksumOK || checksum.ChecksumsFound > 0) {
                detectedType = isVM ? ChecksumType.VAG_EDC15VM_V41 : ChecksumType.VAG_EDC15P_V41;
            }

            // If not found/ok, try v2
            if (result !== ChecksumResult.ChecksumOK && checksum.ChecksumsMatch === 0) {
                result = checksum.tdi41v2_checksum_search(workingBuffer, workingBuffer.length);
                if (result === ChecksumResult.ChecksumOK || checksum.ChecksumsFound > 0) {
                    detectedType = isVM ? ChecksumType.VAG_EDC15VM_V41V2 : ChecksumType.VAG_EDC15P_V41V2;
                }
            }

            // If still not found, try 2002
            if (result !== ChecksumResult.ChecksumOK && checksum.ChecksumsMatch === 0) {
                result = checksum.tdi41_2002_checksum_search(workingBuffer, workingBuffer.length);
                if (result === ChecksumResult.ChecksumOK || checksum.ChecksumsFound > 0) {
                    detectedType = isVM ? ChecksumType.VAG_EDC15VM_V41_2002 : ChecksumType.VAG_EDC15P_V41_2002;
                }
            }

            setDetails({
                checksumType: detectedType,
                result: result,
                totalChecksums: checksum.ChecksumsFound,
                checksumsOk: checksum.ChecksumsMatch,
                checksumsFailed: checksum.ChecksumsIncorrect,
                checked: true
            });

            if (checksum.ChecksumsIncorrect > 0) {
                setIsFixed(true);
            }

            setIsVerifying(false);
        }, 50);
    };

    const handleApplyFix = () => {
        if (!workingBuffer) return;
        // Update the main file buffer in the store
        const newBuffer = workingBuffer.buffer.slice(0) as ArrayBuffer;
        useFileStore.setState({
            fileBuffer: newBuffer,
            checksumStatus: `Fixed ${details.checksumsFailed} checksums`,
            checksumFixedCount: details.checksumsFailed,
            checksumMatchCount: details.checksumsOk
        });
        onClose();
    };

    const getResultColor = () => {
        if (!details.checked) return "text-zinc-500";
        if (details.result === ChecksumResult.ChecksumOK) return "text-green-500";
        if (details.checksumsFailed > 0 && isFixed) return "text-yellow-500";
        return "text-red-500";
    };

    const getResultText = () => {
        if (!details.checked) return "Not Verified";
        if (details.result === ChecksumResult.ChecksumOK) return "All Checksums Valid ✓";
        if (details.checksumsFailed > 0 && isFixed) return `${details.checksumsFailed} Checksum(s) Fixed`;
        if (details.result === ChecksumResult.ChecksumTypeError) return "Checksum Type Error";
        return "Checksum Verification Failed";
    };

    const getFileSizeDisplay = () => {
        if (!fileBuffer) return "N/A";
        const kb = fileBuffer.byteLength / 1024;
        return `${kb} KB (0x${fileBuffer.byteLength.toString(16).toUpperCase()})`;
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-zinc-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden border border-zinc-200 dark:border-zinc-700">
                {/* Header */}
                <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 bg-gradient-to-r from-blue-600 to-blue-700">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Checksum Verification
                    </h2>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    {/* File Info */}
                    <div className="bg-zinc-100 dark:bg-zinc-900 rounded-lg p-4 space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">File:</span>
                            <span className="font-mono text-zinc-700 dark:text-zinc-300 truncate max-w-[200px]">{fileName}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">Size:</span>
                            <span className="font-mono text-zinc-700 dark:text-zinc-300">{getFileSizeDisplay()}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">ECU Type:</span>
                            <span className="font-mono text-zinc-700 dark:text-zinc-300">{fileType}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">Checksum Type:</span>
                            <span className="font-mono text-zinc-700 dark:text-zinc-300">{details.checksumType}</span>
                        </div>
                    </div>

                    {/* Status */}
                    <div className={`text-center py-4 text-lg font-semibold ${getResultColor()}`}>
                        {isVerifying ? (
                            <span className="animate-pulse">Verifying checksums...</span>
                        ) : (
                            getResultText()
                        )}
                    </div>

                    {/* Detailed Results */}
                    {details.checked && (
                        <div className="grid grid-cols-3 gap-3 text-center">
                            <div className="bg-zinc-100 dark:bg-zinc-900 rounded-lg p-3">
                                <div className="text-2xl font-bold text-zinc-700 dark:text-zinc-300">{details.totalChecksums}</div>
                                <div className="text-xs text-zinc-500">Total</div>
                            </div>
                            <div className="bg-green-100 dark:bg-green-900/30 rounded-lg p-3">
                                <div className="text-2xl font-bold text-green-600 dark:text-green-400">{details.checksumsOk}</div>
                                <div className="text-xs text-green-600 dark:text-green-400">Passed</div>
                            </div>
                            <div className={`rounded-lg p-3 ${details.checksumsFailed > 0 ? 'bg-red-100 dark:bg-red-900/30' : 'bg-zinc-100 dark:bg-zinc-900'}`}>
                                <div className={`text-2xl font-bold ${details.checksumsFailed > 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-700 dark:text-zinc-300'}`}>
                                    {details.checksumsFailed}
                                </div>
                                <div className={`text-xs ${details.checksumsFailed > 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-500'}`}>
                                    {isFixed ? 'Fixed' : 'Failed'}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Info Note */}
                    {details.checked && details.checksumsFailed > 0 && (
                        <div className="text-xs text-zinc-500 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                            <strong>Note:</strong> {isFixed
                                ? "Checksums have been recalculated. Click 'Apply Fix' to save changes to the file buffer."
                                : "Checksum errors detected. Verify and fix will recalculate correct checksum values."}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                    >
                        {isFixed && details.checksumsFailed > 0 ? 'Cancel' : 'Close'}
                    </button>

                    {!details.checked && (
                        <button
                            onClick={handleVerify}
                            disabled={isVerifying}
                            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                            {isVerifying ? 'Verifying...' : 'Verify & Fix'}
                        </button>
                    )}

                    {details.checked && details.checksumsFailed > 0 && isFixed && (
                        <button
                            onClick={handleApplyFix}
                            className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                        >
                            Apply Fix
                        </button>
                    )}

                    {details.checked && details.result === ChecksumResult.ChecksumOK && (
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                        >
                            Done
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
