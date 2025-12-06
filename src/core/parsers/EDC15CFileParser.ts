import { SymbolHelper, CodeBlock, AxisHelper, GearboxType, MapSelector, EDCFileType, SymbolCollection } from '../types';
import { Tools } from '../tools';
import { PartNumberConverter } from '../partNumberConverter';

/**
 * Parser for EDC15C ECU variants
 * Uses EDC15CMaps for map identification
 */
export class EDC15CFileParser {

    public parseFile(fileBuffer: ArrayBuffer): { symbols: SymbolCollection, codeBlocks: CodeBlock[], axisHelpers: AxisHelper[] } {
        const allBytes = new Uint8Array(fileBuffer);
        const newCodeBlocks: CodeBlock[] = [];
        const newAxisHelpers: AxisHelper[] = [];
        const newSymbols: SymbolCollection = [];

        this.verifyCodeBlocks(allBytes, newSymbols, newCodeBlocks);

        let len2skip = 0;
        for (let t = 0; t < allBytes.length - 1; t += 2) {
            if (this.checkMap(t, allBytes, newSymbols, newCodeBlocks, (len) => { len2skip = len; })) {
                if (len2skip > 2) len2skip -= 2;
                if ((len2skip % 2) > 0) len2skip -= 1;
                if (len2skip < 0) len2skip = 0;
                t += len2skip;
            }
        }

        // Sort symbols
        newSymbols.sort((a, b) => a.flashStartAddress - b.flashStartAddress);

        this.nameKnownMaps(allBytes, newSymbols, newCodeBlocks);

        this.buildAxisIDList(newSymbols, newAxisHelpers);
        this.matchAxis(newSymbols, newAxisHelpers);
        this.removeNonSymbols(newSymbols, newCodeBlocks);
        this.findSVBL(allBytes, newSymbols, newCodeBlocks);

        return { symbols: newSymbols, codeBlocks: newCodeBlocks, axisHelpers: newAxisHelpers };
    }

    private verifyCodeBlocks(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        let found = true;
        let offset = 0;
        const defaultCodeBlockLength = 0x10000;
        let currentCodeBlockLength = 0;
        let prevCodeBlockStart = 0;

        // Sequence: C1 02 00 68 00 25 03 00 00 10 27
        const sequence = [0xC1, 0x02, 0x00, 0x68, 0x00, 0x25, 0x03, 0x00, 0x00, 0x10, 0x27];
        const mask = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

        while (found) {
            const codeBlockAddress = Tools.findSequence(allBytes, offset, sequence, mask);
            if (codeBlockAddress > 0) {
                const newCodeBlock: CodeBlock = {
                    startAddress: codeBlockAddress - 1,
                    endAddress: 0,
                    codeID: 0,
                    addressID: 0,
                    blockGearboxType: GearboxType.Unknown
                };

                if (prevCodeBlockStart === 0) {
                    prevCodeBlockStart = newCodeBlock.startAddress;
                } else if (currentCodeBlockLength === 0) {
                    currentCodeBlockLength = newCodeBlock.startAddress - prevCodeBlockStart;
                    if (currentCodeBlockLength > 0x10000) currentCodeBlockLength = 0x10000;
                }

                newCodeBlocks.push(newCodeBlock);
                offset = codeBlockAddress + 1;
            } else {
                found = false;
            }
        }

        for (const cb of newCodeBlocks) {
            if (currentCodeBlockLength !== 0) {
                cb.endAddress = cb.startAddress + currentCodeBlockLength - 1;
            } else {
                cb.endAddress = cb.startAddress + defaultCodeBlockLength - 1;
            }
        }

        for (const cb of newCodeBlocks) {
            const autoSeq = [0x45, 0x44, 0x43, 0x20, 0x20, 0x41, 0x47]; // "EDC  AG"
            const manualSeq = [0x45, 0x44, 0x43, 0x20, 0x20, 0x53, 0x47]; // "EDC  SG"
            const maskSeq = [1, 1, 1, 1, 1, 1, 1];

            const autoIndex = Tools.findSequence(allBytes, cb.startAddress, autoSeq, maskSeq);
            const manualIndex = Tools.findSequence(allBytes, cb.startAddress, manualSeq, maskSeq);

            if (autoIndex < cb.endAddress && autoIndex >= cb.startAddress) cb.blockGearboxType = GearboxType.Automatic;
            if (manualIndex < cb.endAddress && manualIndex >= cb.startAddress) cb.blockGearboxType = GearboxType.Manual;
        }

        if (allBytes.length >= 0x80000) {
            this.checkCodeBlock(0x50000, allBytes, newSymbols, newCodeBlocks);
            this.checkCodeBlock(0x60000, allBytes, newSymbols, newCodeBlocks);
            this.checkCodeBlock(0x70000, allBytes, newSymbols, newCodeBlocks);
        }
    }

    private checkCodeBlock(offset: number, allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): number {
        let codeBlockID = 0;
        try {
            if (offset + 0x01004 > allBytes.length) return 0;

            const endOfTable = Tools.readUint16(allBytes, offset + 0x01000, true) + offset;
            const codeBlockAddress = Tools.readUint16(allBytes, offset + 0x01002, true) + offset;

            if (endOfTable === offset + 0xC3C3) return 0;

            if (codeBlockAddress + 2 <= allBytes.length) {
                codeBlockID = Tools.readUint16(allBytes, codeBlockAddress, true);

                for (const cb of newCodeBlocks) {
                    if (cb.startAddress <= codeBlockAddress && cb.endAddress >= codeBlockAddress) {
                        cb.codeID = codeBlockID;
                        cb.addressID = codeBlockAddress;
                    }
                }
            }
        } catch (e) {
            // ignore
        }
        return codeBlockID;
    }

    private checkAxisCount(offset: number, allBytes: Uint8Array, mapSelectors: MapSelector[]): number {
        let axisCount = 0;
        let axisFound = true;
        let t = offset;

        while (axisFound) {
            axisFound = false;
            if (t + 4 > allBytes.length) break;

            const axisid = Tools.readUint16(allBytes, t, true);
            if (this.isAxisID(axisid)) {
                const axislen = Tools.readUint16(allBytes, t + 2, true);
                if (axislen > 0 && axislen < 32) {
                    axisCount++;
                    axisFound = true;
                    t += 4 + (axislen * 2);
                }
            }
        }

        let bytesToSearch = 5120 + 16;
        if (axisCount > 3) {
            while (bytesToSearch > 0 && t + 4 < allBytes.length) {
                const axisid = Tools.readUint16(allBytes, t, true);
                if (this.isAxisID(axisid)) {
                    const axislen = Tools.readUint16(allBytes, t + 2, true);
                    if (axislen <= 10) {
                        let selectorValid = true;
                        let prevSelector = 0;

                        for (let i = 0; i < (axislen * 2); i += 2) {
                            if (t + 4 + (axislen * 2) + 1 + i >= allBytes.length) {
                                selectorValid = false;
                                break;
                            }
                            const val1 = allBytes[t + 4 + (axislen * 2) + i];
                            const val2 = allBytes[t + 4 + (axislen * 2) + 1 + i];
                            const selValue = val1 + val2;

                            if (val1 !== 0) {
                                if (val1 !== 0x40) selectorValid = false;
                                break;
                            }
                            if (val2 > 9) {
                                selectorValid = false;
                                break;
                            }
                            if (prevSelector > selValue) {
                                selectorValid = false;
                                break;
                            }
                            prevSelector = selValue;
                        }

                        if (selectorValid) {
                            const newSel: MapSelector = {
                                numRepeats: axislen,
                                startAddress: t,
                                mapData: [],
                                mapIndexes: [],
                                xAxisAddress: 0,
                                yAxisAddress: 0,
                                xAxisID: 0,
                                yAxisID: 0,
                                xAxisLen: 0,
                                yAxisLen: 0,
                                mapLength: 0
                            };

                            for (let ia = 0; ia < axislen; ia++) {
                                const val = Tools.readUint16(allBytes, t + 4 + (ia * 2), true);
                                newSel.mapData.push(val);
                                newSel.mapIndexes.push(val);
                            }

                            mapSelectors.push(newSel);
                            if (mapSelectors.length > 5) break;
                            bytesToSearch = 5120 + 16;
                        }
                    }
                }
                t += 2;
                bytesToSearch -= 2;
            }
        }

        return axisCount;
    }

    private findSVBL(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        if (!this.findSVBLSequenceOne(allBytes, newSymbols, newCodeBlocks)) {
            this.findSVBLSequenceTwo(allBytes, newSymbols, newCodeBlocks);
        }
    }

    private findSVBLSequenceOne(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): boolean {
        let found = true;
        let SVBLFound = false;
        let offset = 0;

        const seq = [0xD2, 0x00, 0xFC, 0x03, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0xFF, 0xFF, 0xFF, 0xC3, 0x00, 0x00];
        const mask = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1];

        while (found) {
            const SVBLAddress = Tools.findSequence(allBytes, offset, seq, mask);

            if (SVBLAddress > 0) {
                SVBLFound = true;
                const desc = this.determineCodeBlockDescription(SVBLAddress + 16, newCodeBlocks);
                const shsvbl: SymbolHelper = {
                    flashStartAddress: SVBLAddress + 16,
                    length: 2,
                    varname: `SVBL Boost limiter [${desc}]`,
                    userDescription: "",
                    description: "",
                    category: "Detected maps",
                    subcategory: "Limiters",
                    is1D: true,
                    is2D: false,
                    is3D: false,
                    selected: false,
                    xaxisAssigned: false,
                    yaxisAssigned: false,
                    xaxisUnits: "",
                    yaxisUnits: "",
                    xAxisLength: 1,
                    yAxisLength: 1,
                    xAxisID: 0,
                    yAxisID: 0,
                    xAxisAddress: 0,
                    yAxisAddress: 0,
                    xAxisDescr: "",
                    yAxisDescr: "",
                    zAxisDescr: "",
                    xAxisCorrection: 1,
                    xAxisOffset: 0,
                    yAxisCorrection: 1,
                    yAxisOffset: 0,
                    correction: 1,
                    offset: 0,
                    codeBlock: this.determineCodeBlockByAddress(SVBLAddress + 16, newCodeBlocks)
                };

                const testValue = Tools.readUint16(allBytes, shsvbl.flashStartAddress, true);
                if (testValue === 0xC300) {
                    shsvbl.flashStartAddress -= 2;
                }

                this.addToSymbolCollection(newSymbols, shsvbl, newCodeBlocks);

                // Search for MAP/MAF switch near SVBL
                const mapMafSeq = [0x41, 0x02, 0xFF, 0xFF, 0x00, 0x01, 0x01, 0x00];
                const mapMafMask = [1, 1, 0, 0, 1, 1, 1, 1];
                const MAPMAFSwitch = Tools.findSequence(allBytes, Math.max(0, SVBLAddress - 0x100), mapMafSeq, mapMafMask);
                if (MAPMAFSwitch > 0) {
                    const mapMafAddr = MAPMAFSwitch + 2;
                    const mapmafsh: SymbolHelper = {
                        flashStartAddress: mapMafAddr,
                        length: 2,
                        varname: `MAP/MAF switch (0 = MAF, 257/0x101 = MAP) [${this.determineCodeBlockDescription(mapMafAddr, newCodeBlocks)}]`,
                        userDescription: "",
                        description: "Controls whether ECU uses MAP or MAF sensor",
                        category: "Detected maps",
                        subcategory: "Switches",
                        is1D: true, is2D: false, is3D: false,
                        selected: false, xaxisAssigned: false, yaxisAssigned: false,
                        xaxisUnits: "", yaxisUnits: "",
                        xAxisLength: 1, yAxisLength: 1,
                        xAxisID: 0, yAxisID: 0,
                        xAxisAddress: 0, yAxisAddress: 0,
                        xAxisDescr: "", yAxisDescr: "",
                        zAxisDescr: "0 = MAF, 257 = MAP",
                        xAxisCorrection: 1, xAxisOffset: 0,
                        yAxisCorrection: 1, yAxisOffset: 0,
                        correction: 1, offset: 0,
                        codeBlock: this.determineCodeBlockByAddress(mapMafAddr, newCodeBlocks)
                    };
                    this.addToSymbolCollection(newSymbols, mapmafsh, newCodeBlocks);
                }

                offset = SVBLAddress + 1;
            } else {
                found = false;
            }
        }
        return SVBLFound;
    }

    private findSVBLSequenceTwo(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): boolean {
        let found = true;
        let SVBLFound = false;
        let offset = 0;

        const seq = [0xDF, 0x7A, 0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0xDF, 0x7A];
        const mask = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

        while (found) {
            const SVBLAddress = Tools.findSequence(allBytes, offset, seq, mask);

            if (SVBLAddress > 0) {
                SVBLFound = true;
                const desc = this.determineCodeBlockDescription(SVBLAddress - 2, newCodeBlocks);
                const shsvbl: SymbolHelper = {
                    flashStartAddress: SVBLAddress - 2,
                    length: 2,
                    varname: `SVBL Boost limiter [${desc}]`,
                    userDescription: "",
                    description: "",
                    category: "Detected maps",
                    subcategory: "Limiters",
                    is1D: true,
                    is2D: false,
                    is3D: false,
                    selected: false,
                    xaxisAssigned: false,
                    yaxisAssigned: false,
                    xaxisUnits: "",
                    yaxisUnits: "",
                    xAxisLength: 1,
                    yAxisLength: 1,
                    xAxisID: 0,
                    yAxisID: 0,
                    xAxisAddress: 0,
                    yAxisAddress: 0,
                    xAxisDescr: "",
                    yAxisDescr: "",
                    zAxisDescr: "",
                    xAxisCorrection: 1,
                    xAxisOffset: 0,
                    yAxisCorrection: 1,
                    yAxisOffset: 0,
                    correction: 1,
                    offset: 0,
                    codeBlock: this.determineCodeBlockByAddress(SVBLAddress - 2, newCodeBlocks)
                };

                const testValue = Tools.readUint16(allBytes, shsvbl.flashStartAddress, true);
                if (testValue === 0xC300) {
                    shsvbl.flashStartAddress -= 2;
                }

                this.addToSymbolCollection(newSymbols, shsvbl, newCodeBlocks);

                // Search for MAP/MAF switch near SVBL
                const mapMafSeq = [0x41, 0x02, 0xFF, 0xFF, 0x00, 0x01, 0x01, 0x00];
                const mapMafMask = [1, 1, 0, 0, 1, 1, 1, 1];
                const MAPMAFSwitch = Tools.findSequence(allBytes, Math.max(0, SVBLAddress - 0x100), mapMafSeq, mapMafMask);
                if (MAPMAFSwitch > 0) {
                    const mapMafAddr = MAPMAFSwitch + 2;
                    const mapmafsh: SymbolHelper = {
                        flashStartAddress: mapMafAddr,
                        length: 2,
                        varname: `MAP/MAF switch (0 = MAF, 257/0x101 = MAP) [${this.determineCodeBlockDescription(mapMafAddr, newCodeBlocks)}]`,
                        userDescription: "",
                        description: "Controls whether ECU uses MAP or MAF sensor",
                        category: "Detected maps",
                        subcategory: "Switches",
                        is1D: true, is2D: false, is3D: false,
                        selected: false, xaxisAssigned: false, yaxisAssigned: false,
                        xaxisUnits: "", yaxisUnits: "",
                        xAxisLength: 1, yAxisLength: 1,
                        xAxisID: 0, yAxisID: 0,
                        xAxisAddress: 0, yAxisAddress: 0,
                        xAxisDescr: "", yAxisDescr: "",
                        zAxisDescr: "0 = MAF, 257 = MAP",
                        xAxisCorrection: 1, xAxisOffset: 0,
                        yAxisCorrection: 1, yAxisOffset: 0,
                        correction: 1, offset: 0,
                        codeBlock: this.determineCodeBlockByAddress(mapMafAddr, newCodeBlocks)
                    };
                    this.addToSymbolCollection(newSymbols, mapmafsh, newCodeBlocks);
                }

                offset = SVBLAddress + 1;
            } else {
                found = false;
            }
        }
        return SVBLFound;
    }

    private determineCodeBlockByAddress(address: number, currBlocks: CodeBlock[]): number {
        for (const cb of currBlocks) {
            if (cb.startAddress <= address && cb.endAddress >= address) {
                return cb.codeID;
            }
        }
        return 0;
    }

    private checkMap(t: number, allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[], setLen2Skip: (len: number) => void): boolean {
        let len2Skip = 0;
        let mapSelectors: MapSelector[] = [];

        if (t < allBytes.length - 0x100) {
            if (this.checkAxisCount(t, allBytes, mapSelectors) > 3) {
                // Skip
            }

            const xaxisid = Tools.readUint16(allBytes, t, true);

            if (this.isAxisID(xaxisid)) {
                const xaxislen = Tools.readUint16(allBytes, t + 2, true);

                if (this.isValidLength(xaxislen, xaxisid)) {
                    const yAxisOffset = t + 4 + (xaxislen * 2);
                    if (yAxisOffset + 4 > allBytes.length) return false;

                    const yaxisid = Tools.readUint16(allBytes, yAxisOffset, true);
                    const yaxislen = Tools.readUint16(allBytes, yAxisOffset + 2, true);

                    if (this.isAxisID(yaxisid) && this.isValidLength(yaxislen, yaxisid)) {
                        // 3D Map Found
                        const mapDataLen = xaxislen * yaxislen;
                        const dataSize = mapDataLen * 2;
                        const totalLen = 4 + (xaxislen * 2) + 4 + (yaxislen * 2) + dataSize;

                        const mapDataAddress = t + 8 + (xaxislen * 2) + (yaxislen * 2);

                        const sh: SymbolHelper = {
                            flashStartAddress: mapDataAddress,
                            length: dataSize,
                            varname: `3D ${mapDataAddress.toString(16).toUpperCase().padStart(8, '0')} ${xaxisid.toString(16).toUpperCase().padStart(4, '0')} ${yaxisid.toString(16).toUpperCase().padStart(4, '0')}`,
                            userDescription: "",
                            description: "",
                            category: "Potential Maps",
                            subcategory: "3D",
                            is1D: false,
                            is2D: false,
                            is3D: true,
                            selected: false,
                            xaxisAssigned: false,
                            yaxisAssigned: false,
                            xaxisUnits: "",
                            yaxisUnits: "",
                            xAxisLength: xaxislen,
                            yAxisLength: yaxislen,
                            xAxisID: xaxisid,
                            yAxisID: yaxisid,
                            xAxisAddress: t + 4,
                            yAxisAddress: t + 8 + (xaxislen * 2),
                            xAxisDescr: "",
                            yAxisDescr: "",
                            zAxisDescr: "",
                            xAxisCorrection: 1,
                            xAxisOffset: 0,
                            yAxisCorrection: 1,
                            yAxisOffset: 0,
                            correction: 0.1,
                            offset: 0,
                            codeBlock: 0
                        };

                        if (this.addToSymbolCollection(newSymbols, sh, newCodeBlocks)) {
                            setLen2Skip(totalLen);
                            return true;
                        }
                    }
                }
            }

            if (this.isAxisID(xaxisid)) {
                const xaxislen = Tools.readUint16(allBytes, t + 2, true);
                if (this.isValidLength(xaxislen, xaxisid)) {
                    const axisDataLen = xaxislen * 2;
                    const curveDataLen = xaxislen * 2;
                    const totalLen = 4 + axisDataLen + curveDataLen;

                    const curveStart = t + 4 + axisDataLen;
                    const possibleAxisID = Tools.readUint16(allBytes, curveStart, true);

                    if (!this.isAxisID(possibleAxisID)) {
                        const curveDataAddress = t + 4 + (xaxislen * 2);

                        const sh: SymbolHelper = {
                            flashStartAddress: curveDataAddress,
                            length: curveDataLen,
                            varname: `2D ${curveDataAddress.toString(16).toUpperCase().padStart(8, '0')} ${xaxisid.toString(16).toUpperCase().padStart(4, '0')}`,
                            userDescription: "",
                            description: "",
                            category: "Potential Maps",
                            subcategory: "2D",
                            is1D: false,
                            is2D: true,
                            is3D: false,
                            selected: false,
                            xaxisAssigned: false,
                            yaxisAssigned: false,
                            xaxisUnits: "",
                            yaxisUnits: "",
                            xAxisLength: xaxislen,
                            yAxisLength: 1,
                            xAxisID: xaxisid,
                            yAxisID: 0,
                            xAxisAddress: t + 4,
                            yAxisAddress: 0,
                            xAxisDescr: "",
                            yAxisDescr: "",
                            zAxisDescr: "",
                            xAxisCorrection: 1,
                            xAxisOffset: 0,
                            yAxisCorrection: 1,
                            yAxisOffset: 0,
                            correction: 0.1,
                            offset: 0,
                            codeBlock: 0
                        };

                        if (this.addToSymbolCollection(newSymbols, sh, newCodeBlocks)) {
                            setLen2Skip(totalLen);
                            return true;
                        }
                    }
                }
            }

        }
        setLen2Skip(0);
        return false;
    }

    // EDC15C axis IDs - based on C# EDC15CFileParser
    private isAxisID(id: number): boolean {
        const idstrip = Math.floor(id / 256);
        if (idstrip === 0xDB) return true;
        if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC4, 0xC5].includes(idstrip)) return true;
        if ([0xE0, 0xE4, 0xE5, 0xE6, 0xE9, 0xEA, 0xEB, 0xEC].includes(idstrip)) return true;
        if ([0xDA, 0xDC, 0xDD, 0xDE].includes(idstrip)) return true;
        if ([0xF9, 0xFE].includes(idstrip)) return true;
        if ([0xD5, 0xD7, 0xD9, 0xE8].includes(idstrip)) return true;
        if (idstrip === 0xD0) return true;
        if ([0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xCB, 0xCC, 0xCD, 0xCE, 0xCF].includes(idstrip)) return true;
        return false;
    }

    private isValidLength(length: number, id: number): boolean {
        const idstrip = Math.floor(id / 256);
        if ((idstrip & 0xF0) === 0xE0) {
            if (length > 0 && length <= 32) return true;
        } else {
            if (length > 0 && length < 32) return true;
        }
        return false;
    }

    private addToSymbolCollection(newSymbols: SymbolCollection, newSymbol: SymbolHelper, newCodeBlocks: CodeBlock[]): boolean {
        if (newSymbol.length >= 800) return false;
        for (const sh of newSymbols) {
            if (sh.flashStartAddress === newSymbol.flashStartAddress) return false;
        }
        newSymbols.push(newSymbol);
        newSymbol.codeBlock = this.determineCodeBlockByAddress(newSymbol.flashStartAddress, newCodeBlocks);
        return true;
    }

    private determineCodeBlockDescription(address: number, currBlocks: CodeBlock[]): string {
        for (const cb of currBlocks) {
            if (cb.startAddress <= address && cb.endAddress >= address) {
                let desc = `Codeblock ${cb.codeID}`;
                if (cb.blockGearboxType === GearboxType.Manual) desc += ", Manual";
                else if (cb.blockGearboxType === GearboxType.Automatic) desc += ", Automatic";
                else if (cb.blockGearboxType === GearboxType.FourByFour) desc += ", 4x4";
                else if (cb.codeID === 2) desc += ", Manual";
                else if (cb.codeID === 3) desc += ", 4x4";

                return desc;
            }
        }
        return `Flashbank ${Math.floor(address / 0x10000)}`;
    }

    private nameKnownMaps(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        for (const sh of newSymbols) {
            const xAxisHighByte = Math.floor(sh.xAxisID / 256);
            const yAxisHighByte = Math.floor(sh.yAxisID / 256);

            // ========== Length 700: Launch control map ==========
            if (sh.length === 700) {
                sh.category = "Detected maps";
                sh.subcategory = "Launch Control";
                sh.varname = `Launch control map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                sh.yAxisCorrection = 0.15625;
                sh.correction = 0.01;
                sh.xAxisDescr = "Engine speed (rpm)";
                sh.yAxisDescr = "Approx. vehicle speed (km/h)";
                sh.zAxisDescr = "IQ limit";
                sh.yaxisUnits = "km/h";
                sh.xaxisUnits = "rpm";
            }

            // ========== Length 570: Injector duration ==========
            else if (sh.length === 570) {
                if ((xAxisHighByte === 0xC5 && yAxisHighByte === 0xEC) ||
                    (xAxisHighByte === 0xC4 && yAxisHighByte === 0xEA) ||
                    (xAxisHighByte === 0xC4 && yAxisHighByte === 0xEC)) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Fuel";
                    const injDurCount = this.getMapNameCountForCodeBlock("Injector duration", sh.codeBlock, newSymbols);
                    sh.varname = `Injector duration ${String(injDurCount - 1).padStart(2, '0')} [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.yAxisCorrection = 0.01;
                    sh.correction = 0.023437;
                    sh.xAxisDescr = "Engine speed (rpm)";
                    sh.yAxisDescr = "Requested Quantity mg/stroke";
                    sh.zAxisDescr = "Duration (crankshaft degrees)";
                    sh.xaxisUnits = "rpm";
                    sh.yaxisUnits = "mg/st";
                }
            }

            // ========== Length 480: Injector duration ==========
            else if (sh.length === 480) {
                if ((xAxisHighByte === 0xC5 && yAxisHighByte === 0xEC) ||
                    (xAxisHighByte === 0xC4 && yAxisHighByte === 0xEA)) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Fuel";
                    const injDurCount = this.getMapNameCountForCodeBlock("Injector duration", sh.codeBlock, newSymbols);
                    sh.varname = `Injector duration ${String(injDurCount - 1).padStart(2, '0')} [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.yAxisCorrection = 0.01;
                    sh.correction = 0.023437;
                    sh.xAxisDescr = "Engine speed (rpm)";
                    sh.yAxisDescr = "Requested Quantity mg/stroke";
                    sh.zAxisDescr = "Duration (crankshaft degrees)";
                    sh.xaxisUnits = "rpm";
                    sh.yaxisUnits = "mg/st";
                }
            }

            // ========== Length 416: EGR, Smoke limiter, N75, IQ limiter ==========
            else if (sh.length === 416) {
                if (xAxisHighByte === 0xF9 && yAxisHighByte === 0xDA) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Limiters";
                    sh.varname = `Smoke limiter [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.zAxisDescr = "Maximum IQ (mg)";
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.xAxisDescr = "Airflow mg/stroke";
                    sh.correction = 0.01;
                    sh.xAxisCorrection = 0.1;
                    sh.yaxisUnits = "rpm";
                    sh.xaxisUnits = "mg/st";
                } else if (xAxisHighByte === 0xEC && yAxisHighByte === 0xDA) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Limiters";
                    const iqMAFCount = this.getMapNameCountForCodeBlock("IQ by MAF limiter", sh.codeBlock, newSymbols);
                    sh.varname = `IQ by MAF limiter ${iqMAFCount} [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.zAxisDescr = "Maximum IQ (mg)";
                    sh.correction = 0.01;
                    sh.xAxisCorrection = 0.1;
                    sh.xaxisUnits = "mg/st";
                    sh.xAxisDescr = "Airflow mg/stroke";
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.yaxisUnits = "rpm";
                } else if (xAxisHighByte === 0xEC && yAxisHighByte === 0xEA) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Turbo";
                    sh.varname = `N75 duty cycle [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.zAxisDescr = "Duty cycle %";
                    sh.correction = -0.01;
                    sh.offset = 100;
                    sh.xAxisCorrection = 0.01;
                    sh.xAxisDescr = "IQ (mg/stroke)";
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.yaxisUnits = "rpm";
                    sh.xaxisUnits = "mg/st";
                } else if (xAxisHighByte === 0xEC && (yAxisHighByte === 0xC0 || yAxisHighByte === 0xE9)) {
                    if (sh.yAxisAddress > 0 && allBytes[sh.yAxisAddress] === 0 && allBytes[sh.yAxisAddress + 1] === 0) {
                        sh.category = "Detected maps";
                        sh.subcategory = "EGR";
                        const egrCount = this.getMapNameCountForCodeBlock("EGR", sh.codeBlock, newSymbols);
                        sh.varname = `EGR ${String(egrCount).padStart(2, '0')} [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                        sh.correction = 0.1;
                        sh.xAxisCorrection = 0.01;
                        sh.zAxisDescr = "Mass Air Flow (mg/stroke)";
                        sh.xAxisDescr = "IQ (mg/stroke)";
                        sh.yAxisDescr = "Engine speed (rpm)";
                        sh.yaxisUnits = "rpm";
                        sh.xaxisUnits = "mg/st";
                    }
                }
            }

            // ========== Length 384: Inverse driver wish, EGR ==========
            else if (sh.length === 384) {
                if (sh.xAxisLength === 12 && sh.yAxisLength === 16) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Misc";
                    sh.varname = `Inverse driver wish [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.correction = 0.01;
                    sh.xAxisCorrection = 0.01;
                    sh.zAxisDescr = "Throttle position";
                    sh.xAxisDescr = "IQ (mg/stroke)";
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.yaxisUnits = "rpm";
                    sh.xaxisUnits = "mg/st";
                }
            }

            // ========== Length 320: Boost map, Boost target ==========
            else if (sh.length === 320) {
                if (xAxisHighByte === 0xC0 && yAxisHighByte === 0xDA) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Turbo";
                    sh.varname = `Boost map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.correction = 1;
                    sh.zAxisDescr = "Requested boost (mbar)";
                    sh.xAxisDescr = "Engine speed (rpm)";
                    sh.yAxisDescr = "IQ (mg/stroke)";
                    sh.xaxisUnits = "rpm";
                    sh.yaxisUnits = "mg/st";
                } else if (xAxisHighByte === 0xEC && yAxisHighByte === 0xEA) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Turbo";
                    sh.varname = `Boost target map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.correction = 1;
                    sh.zAxisDescr = "Requested boost (mbar)";
                    sh.xAxisDescr = "IQ (mg/stroke)";
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.xAxisCorrection = 0.01;
                    sh.xaxisUnits = "mg/st";
                    sh.yaxisUnits = "rpm";
                }
            }

            // ========== Length 256: Driver wish ==========
            else if (sh.length === 256) {
                if (sh.xAxisLength === 16 && sh.yAxisLength === 8) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Misc";
                    sh.varname = `Driver wish [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.correction = 0.01;
                    sh.xAxisCorrection = 0.01;
                    sh.zAxisDescr = "Requested IQ (mg)";
                    sh.xAxisDescr = "Throttle position (%)";
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.yaxisUnits = "rpm";
                    sh.xaxisUnits = "%";
                }
            }

            // ========== Length 162: Start IQ ==========
            else if (sh.length === 162) {
                sh.category = "Detected maps";
                sh.subcategory = "Fuel";
                const startIQCount = this.getMapNameCountForCodeBlock("Start IQ", sh.codeBlock, newSymbols);
                sh.varname = `Start IQ (${startIQCount}) [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                sh.correction = 0.01;
                sh.zAxisDescr = "Start IQ (mg)";
                sh.xAxisDescr = "Coolant temperature";
                sh.yAxisDescr = "Engine speed (rpm)";
                sh.yaxisUnits = "rpm";
                sh.xaxisUnits = "°C";
            }

            // ========== Length 60: EGR temperature map ==========
            else if (sh.length === 60) {
                if (sh.xAxisLength === 5 && sh.yAxisLength === 6) {
                    sh.category = "Detected maps";
                    sh.subcategory = "EGR";
                    sh.varname = `EGR temperature map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.zAxisDescr = "EGR position";
                    sh.xAxisDescr = "Temperature";
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.yaxisUnits = "rpm";
                    sh.xaxisUnits = "°C";
                }
            }

            // ========== Length 126: Torque limiter ==========
            else if (sh.length === 126) {
                if (sh.xAxisLength === 3 && sh.yAxisLength === 21) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Limiters";
                    sh.varname = `Torque limiter [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.correction = 0.01;
                    sh.zAxisDescr = "Maximum IQ (mg)";
                    sh.xAxisDescr = "Engine speed (rpm)";
                    sh.yAxisDescr = "Gear";
                    sh.xaxisUnits = "rpm";
                }
            }
        }
    }

    private getMapNameCountForCodeBlock(baseName: string, codeBlock: number, currentSymbols: SymbolCollection): number {
        let count = 0;
        for (const sh of currentSymbols) {
            if (sh.varname && sh.varname.startsWith(baseName) && sh.codeBlock === codeBlock) {
                count++;
            }
        }
        return count + 1;
    }

    private buildAxisIDList(newSymbols: SymbolCollection, newAxisHelpers: AxisHelper[]): void {
        for (const sh of newSymbols) {
            if (!sh.varname.startsWith("2D") && !sh.varname.startsWith("3D")) {
                this.addToAxisCollection(newAxisHelpers, sh.yAxisID, sh.xAxisDescr, sh.xaxisUnits, sh.xAxisCorrection, sh.xAxisOffset);
                this.addToAxisCollection(newAxisHelpers, sh.xAxisID, sh.yAxisDescr, sh.yaxisUnits, sh.yAxisCorrection, sh.yAxisOffset);
            }
        }
    }

    private addToAxisCollection(newAxisHelpers: AxisHelper[], id: number, descr: string, units: string, correction: number, offset: number): void {
        if (id === 0) return;
        for (const ah of newAxisHelpers) {
            if (ah.axisID === id) return;
        }
        newAxisHelpers.push({
            axisID: id,
            description: descr,
            units: units,
            correction: correction,
            offset: offset
        });
    }

    private matchAxis(newSymbols: SymbolCollection, newAxisHelpers: AxisHelper[]): void {
        for (const sh of newSymbols) {
            if (!sh.yaxisAssigned) {
                for (const ah of newAxisHelpers) {
                    if (sh.xAxisID === ah.axisID) {
                        sh.yAxisDescr = ah.description;
                        sh.yaxisUnits = ah.units;
                        sh.yAxisOffset = ah.offset;
                        sh.yAxisCorrection = ah.correction;
                        sh.yaxisAssigned = true;
                        break;
                    }
                }
            }
            if (!sh.xaxisAssigned) {
                for (const ah of newAxisHelpers) {
                    if (sh.yAxisID === ah.axisID) {
                        sh.xAxisDescr = ah.description;
                        sh.xaxisUnits = ah.units;
                        sh.xAxisOffset = ah.offset;
                        sh.xAxisCorrection = ah.correction;
                        sh.xaxisAssigned = true;
                        break;
                    }
                }
            }
        }
    }

    private removeNonSymbols(newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        if (newCodeBlocks.length > 0) {
            for (const sh of newSymbols) {
                if (sh.codeBlock === 0 && (sh.varname.startsWith("2D") || sh.varname.startsWith("3D"))) {
                    sh.subcategory = "Zero codeblock stuff";
                }
            }
        }
    }

}
