"use client";

import React, { useState, useRef, useEffect } from "react";
import { useFileStore } from "@/src/store/useFileStore";
import { MapList } from "@/src/components/MapList";
import { MapTable } from "@/src/components/MapTable";
import { MapChart } from "@/src/components/MapChart";
import { HexViewer } from "@/src/components/HexViewer";
import { ChecksumModal } from "@/src/components/ChecksumModal";
import {
    supportsLaunchControl,
    hasLaunchControlMap,
    addLaunchControlMap,
    getLaunchControlStatus
} from "@/src/core/launchControlAdder";

type ViewMode = 'map' | 'hex';

export default function Home() {
    const loadResult = useFileStore((state) => state.loadResult);
    const addLaunchControlSymbols = useFileStore((state) => state.addLaunchControlSymbols);
    const symbols = useFileStore((state) => state.symbols);
    const fileName = useFileStore((state) => state.fileName);
    const fileType = useFileStore((state) => state.fileType);
    const isParsing = useFileStore((state) => state.isParsing);
    const selectedSymbol = useFileStore((state) => state.selectedSymbol);
    const fileBuffer = useFileStore((state) => state.fileBuffer);
    const checksumStatus = useFileStore((state) => state.checksumStatus);

    const [viewMode, setViewMode] = useState<ViewMode>('map');
    const [isChecksumModalOpen, setIsChecksumModalOpen] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isMapListOpen, setIsMapListOpen] = useState(true);
    const [launchControlMessage, setLaunchControlMessage] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setIsMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Automatically open sidebar when file is loaded
    useEffect(() => {
        if (fileBuffer) {
            setIsMapListOpen(true);
        }
    }, [fileBuffer]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const buffer = await file.arrayBuffer();
        loadResult(buffer, file.name);
    };

    const handleDownload = () => {
        if (!fileBuffer) return;

        const blob = new Blob([fileBuffer], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const parts = fileName.split(".");
        const ext = parts.pop();
        const name = parts.join(".");
        a.download = `${name}_mod.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setIsMenuOpen(false);
    };

    // Launch control status
    const launchStatus = getLaunchControlStatus(fileType, symbols);
    const hasLaunchControl = hasLaunchControlMap(symbols);
    const launchControlSupported = supportsLaunchControl(fileType);

    const handleAddLaunchControl = () => {
        console.log("[Page] handleAddLaunchControl called, hasLaunchControl:", hasLaunchControl, "supported:", launchControlSupported);
        if (!fileBuffer || hasLaunchControl || !launchControlSupported) {
            console.log("[Page] Early return - fileBuffer:", !!fileBuffer, "hasLaunchControl:", hasLaunchControl, "supported:", launchControlSupported);
            return;
        }

        console.log("[Page] Calling addLaunchControlMap with buffer size:", fileBuffer.byteLength);
        const result = addLaunchControlMap(fileBuffer);
        console.log("[Page] addLaunchControlMap result:", result.success, result.message);

        if (result.success) {
            // Directly add launch control symbols to the store instead of re-parsing
            console.log("[Page] Calling addLaunchControlSymbols with", result.locationsFound.length, "locations");
            addLaunchControlSymbols(result.buffer, result.locationsFound);
            setLaunchControlMessage(result.message);
            setTimeout(() => setLaunchControlMessage(null), 5000);
        } else {
            setLaunchControlMessage(result.message);
            setTimeout(() => setLaunchControlMessage(null), 5000);
        }
        setIsMenuOpen(false);
    };

    return (
        <div className="flex h-screen bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 overflow-hidden font-sans">
            {/* Sidebar - Only show in Map mode when file is loaded */}
            {viewMode === 'map' && fileBuffer && (
                <MapList isOpen={isMapListOpen} onToggle={() => setIsMapListOpen(!isMapListOpen)} />
            )}

            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header */}
                <header className="flex-shrink-0 p-4 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center bg-white dark:bg-zinc-900">
                    <div className="flex items-center gap-4">
                        <h1 className="text-xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
                            EDC Suite <span className="text-sm font-normal text-zinc-500 ml-2">Beta v0.4</span>
                        </h1>

                        {fileBuffer && (
                            <div className="relative" ref={menuRef}>
                                {/* Menu Button */}
                                <button
                                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                                    className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                                    </svg>
                                    Menu
                                    <svg className={`w-3 h-3 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>

                                {/* Dropdown Menu */}
                                {isMenuOpen && (
                                    <div className="absolute left-0 top-full mt-1 w-56 bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 py-1 z-50">
                                        {/* View Section */}
                                        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">View</div>

                                        <button
                                            onClick={() => { setViewMode('map'); setIsMenuOpen(false); }}
                                            className={`w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors ${viewMode === 'map' ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'text-zinc-700 dark:text-zinc-300'}`}
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                                            </svg>
                                            Map View
                                            {viewMode === 'map' && <span className="ml-auto text-blue-500">✓</span>}
                                        </button>

                                        <button
                                            onClick={() => { setViewMode('hex'); setIsMenuOpen(false); }}
                                            className={`w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors ${viewMode === 'hex' ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'text-zinc-700 dark:text-zinc-300'}`}
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                                            </svg>
                                            Hex View
                                            {viewMode === 'hex' && <span className="ml-auto text-blue-500">✓</span>}
                                        </button>

                                        <div className="my-1 border-t border-zinc-200 dark:border-zinc-700"></div>

                                        {/* Tools Section */}
                                        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Tools</div>

                                        <button
                                            onClick={() => { setIsChecksumModalOpen(true); setIsMenuOpen(false); }}
                                            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            Checksums
                                            {checksumStatus && (
                                                <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${checksumStatus.includes('OK') ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'}`}>
                                                    {checksumStatus}
                                                </span>
                                            )}
                                        </button>

                                        {launchControlSupported && (
                                            <button
                                                onClick={handleAddLaunchControl}
                                                disabled={hasLaunchControl}
                                                className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors ${hasLaunchControl ? 'text-zinc-400 cursor-not-allowed' : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700'}`}
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                                </svg>
                                                Add Launch Control
                                                {hasLaunchControl && <span className="ml-auto text-xs text-green-500">Added</span>}
                                            </button>
                                        )}

                                        <div className="my-1 border-t border-zinc-200 dark:border-zinc-700"></div>

                                        {/* File Section */}
                                        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">File</div>

                                        <button
                                            onClick={handleDownload}
                                            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                            </svg>
                                            Download Modified
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        {fileBuffer && (
                            <span className="text-xs px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-mono">
                                {fileType}
                            </span>
                        )}
                        <div className="text-sm font-mono text-zinc-500">{fileName}</div>
                    </div>
                </header>

                {/* Main Content */}
                <main className="flex-1 overflow-hidden relative flex flex-col">
                    {/* File Upload if not loaded */}
                    {(!fileBuffer) && !isParsing && (
                        <section className="w-full max-w-2xl mx-auto mt-20 animate-in fade-in zoom-in duration-300 p-8">
                            <div className="relative flex flex-col items-center justify-center w-full h-64 border-2 border-zinc-300 dark:border-zinc-700 border-dashed rounded-lg cursor-pointer bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                    <svg className="w-10 h-10 mb-4 text-zinc-400" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 16">
                                        <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2" />
                                    </svg>
                                    <p className="mb-2 text-sm text-zinc-500 dark:text-zinc-400"><span className="font-semibold">Click to upload</span> or drag and drop</p>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">EDC15P Binary Files (.bin, .ori)</p>
                                </div>
                                <input id="dropzone-file" type="file" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={handleFileUpload} accept=".bin,.ori" />
                            </div>
                        </section>
                    )}

                    {isParsing && (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-xl text-blue-400 animate-pulse">Parsing file...</div>
                        </div>
                    )}

                    {/* Map View Mode */}
                    {viewMode === 'map' && fileBuffer && (
                        <>
                            {symbols.length > 0 && !selectedSymbol && (
                                <div className="flex flex-col items-center justify-center h-full text-zinc-500 space-y-4">
                                    <p className="text-lg">Select a map from the sidebar to view details.</p>
                                </div>
                            )}

                            {selectedSymbol && (
                                <div className="flex flex-col h-full">
                                    <div className="h-72 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex-shrink-0">
                                        <MapChart symbol={selectedSymbol} fileBuffer={fileBuffer} />
                                    </div>
                                    <div className="flex-1 overflow-hidden">
                                        <MapTable symbol={selectedSymbol} fileBuffer={fileBuffer} />
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* Hex View Mode */}
                    {viewMode === 'hex' && fileBuffer && (
                        <div className="h-full w-full overflow-hidden">
                            <HexViewer data={new Uint8Array(fileBuffer)} />
                        </div>
                    )}
                </main>
            </div>

            {/* Launch Control Notification */}
            {launchControlMessage && (
                <div className={`fixed bottom-4 right-4 max-w-sm p-4 rounded-lg shadow-lg z-50 ${launchControlMessage.includes('activated') ? 'bg-green-500' : 'bg-yellow-500'} text-white`}>
                    <div className="flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span className="text-sm font-medium">{launchControlMessage}</span>
                    </div>
                </div>
            )}

            {/* Checksum Modal */}
            <ChecksumModal
                isOpen={isChecksumModalOpen}
                onClose={() => setIsChecksumModalOpen(false)}
            />
        </div>
    );
}