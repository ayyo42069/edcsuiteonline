import { SymbolHelper, CodeBlock, AxisHelper, GearboxType, MapSelector, EDCFileType, SymbolCollection } from '../types';
import { Tools } from '../tools';
import { PartNumberConverter } from '../partNumberConverter';

/**
 * Parser for EDC15M ECU variants
 * Based on C# EDC15MFileParser.cs with inline map detection
 */
export class EDC15MFileParser {

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
            }
        }

        // Sort symbols
        newSymbols.sort((a, b) => a.flashStartAddress - b.flashStartAddress);

        this.nameKnownMaps(allBytes, newSymbols, newCodeBlocks);
        this.buildAxisIDList(newSymbols, newAxisHelpers);
        this.matchAxis(newSymbols, newAxisHelpers);
        this.findSVBL(allBytes, newSymbols, newCodeBlocks);

        return { symbols: newSymbols, codeBlocks: newCodeBlocks, axisHelpers: newAxisHelpers };
    }

    private verifyCodeBlocks(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        let found = true;
        let offset = 0;
        const defaultCodeBlockLength = 0x10000;
        let currentCodeBlockLength = 0;
        let prevCodeBlockStart = 0;

        // EDC15M sequence detection
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

        // Check gearbox type
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

    private isAxisID(id: number): boolean {
        const idstrip = Math.floor(id / 256);
        // EDC15M specific axis IDs
        if (idstrip === 0xDB) return true;
        if (idstrip === 0xC0 || idstrip === 0xC1 || idstrip === 0xC2 || idstrip === 0xC4 || idstrip === 0xC5) return true;
        if (idstrip === 0xE0 || idstrip === 0xE4 || idstrip === 0xE5 || idstrip === 0xE9 || idstrip === 0xEA || idstrip === 0xEB || idstrip === 0xEC) return true;
        if (idstrip === 0xDA || idstrip === 0xDC || idstrip === 0xDD || idstrip === 0xDE) return true;
        if (idstrip === 0xF9 || idstrip === 0xFE || idstrip === 0xFC) return true;
        if (idstrip === 0xD7 || idstrip === 0xE6) return true;
        if (idstrip === 0xD5) return true;
        return false;
    }

    private isValidLength(length: number, id: number): boolean {
        const idstrip = Math.floor(id / 256);
        if (idstrip === 0xEB) {
            if (length > 0 && length <= 32) return true;
        } else {
            if (length > 0 && length < 32) return true;
        }
        return false;
    }

    private checkMap(t: number, allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[], setLen2Skip: (len: number) => void): boolean {
        let retval = false;
        let len2Skip = 0;

        if (t < allBytes.length - 0x100) {
            const xaxisid = Tools.readUint16(allBytes, t, true);

            if (this.isAxisID(xaxisid)) {
                const xaxislen = Tools.readUint16(allBytes, t + 2, true);

                if (this.isValidLength(xaxislen, xaxisid)) {
                    const yaxisid = Tools.readUint16(allBytes, t + 4 + (xaxislen * 2), true);
                    const yaxislen = Tools.readUint16(allBytes, t + 6 + (xaxislen * 2), true);

                    if (this.isAxisID(yaxisid) && this.isValidLength(yaxislen, yaxisid)) {
                        // 3D map
                        const newSymbol = this.createSymbolHelper();
                        newSymbol.xAxisLength = xaxislen;
                        newSymbol.yAxisLength = yaxislen;
                        newSymbol.xAxisID = xaxisid;
                        newSymbol.yAxisID = yaxisid;
                        newSymbol.xAxisAddress = t + 4;
                        newSymbol.yAxisAddress = t + 8 + (xaxislen * 2);
                        newSymbol.length = xaxislen * yaxislen * 2;
                        newSymbol.flashStartAddress = t + 8 + (xaxislen * 2) + (yaxislen * 2);
                        newSymbol.varname = `3D ${newSymbol.flashStartAddress.toString(16).toUpperCase().padStart(8, '0')} ${xaxisid.toString(16).toUpperCase().padStart(4, '0')} ${yaxisid.toString(16).toUpperCase().padStart(4, '0')}`;

                        retval = this.addToSymbolCollection(newSymbols, newSymbol, newCodeBlocks);
                        if (retval) {
                            len2Skip += (xaxislen * 2) + (yaxislen * 2) + newSymbol.length;
                        }
                    } else {
                        // 2D map
                        const newSymbol = this.createSymbolHelper();
                        newSymbol.xAxisLength = xaxislen;
                        newSymbol.xAxisID = xaxisid;
                        newSymbol.xAxisAddress = t + 4;
                        newSymbol.length = xaxislen * 2;
                        newSymbol.flashStartAddress = t + 4 + (xaxislen * 2);
                        newSymbol.varname = `2D ${newSymbol.flashStartAddress.toString(16).toUpperCase().padStart(8, '0')} ${xaxisid.toString(16).toUpperCase().padStart(4, '0')}`;

                        newSymbol.codeBlock = this.determineCodeBlockByAddress(newSymbol.flashStartAddress, newCodeBlocks);
                        retval = this.addToSymbolCollection(newSymbols, newSymbol, newCodeBlocks);
                        if (retval) {
                            len2Skip += (xaxislen * 2);
                        }
                    }
                }
            }
        }
        setLen2Skip(len2Skip);
        return retval;
    }

    private createSymbolHelper(): SymbolHelper {
        return {
            varname: '',
            flashStartAddress: 0,
            length: 0,
            xAxisLength: 1,
            yAxisLength: 1,
            xAxisAddress: 0,
            yAxisAddress: 0,
            xAxisID: 0,
            yAxisID: 0,
            correction: 1,
            offset: 0,
            xAxisCorrection: 1,
            xAxisOffset: 0,
            yAxisCorrection: 1,
            yAxisOffset: 0,
            xAxisDescr: '',
            yAxisDescr: '',
            zAxisDescr: '',
            xaxisUnits: '',
            yaxisUnits: '',
            category: 'Potential Maps',
            subcategory: '',
            codeBlock: 0,
            description: '',
            xaxisAssigned: false,
            yaxisAssigned: false,
            mapSelector: undefined,
            is1D: false,
            is2D: false,
            is3D: false,
            selected: false,
            userDescription: ''
        };
    }

    private addToSymbolCollection(newSymbols: SymbolCollection, newSymbol: SymbolHelper, newCodeBlocks: CodeBlock[]): boolean {
        if (newSymbol.length >= 800) return false;
        for (const sh of newSymbols) {
            if (sh.flashStartAddress === newSymbol.flashStartAddress) {
                return false;
            }
        }
        newSymbols.push(newSymbol);
        newSymbol.codeBlock = this.determineCodeBlockByAddress(newSymbol.flashStartAddress, newCodeBlocks);
        return true;
    }

    private determineCodeBlockByAddress(address: number, currBlocks: CodeBlock[]): number {
        for (const cb of currBlocks) {
            if (cb.startAddress <= address && cb.endAddress >= address) {
                return cb.codeID;
            }
        }
        return 0;
    }

    private determineCodeBlockDescription(address: number, currBlocks: CodeBlock[]): string {
        for (const cb of currBlocks) {
            if (cb.startAddress <= address && cb.endAddress >= address) {
                let desc = `Codeblock ${cb.codeID}`;
                if (cb.blockGearboxType === GearboxType.Automatic) desc += " AUT";
                return desc;
            }
        }
        return `Flashbank ${Math.floor(address / 0x10000)}`;
    }

    // ==================== EDC15M Map Detection ====================
    private nameKnownMaps(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        for (const sh of newSymbols) {
            const xAxisHighByte = Math.floor(sh.xAxisID / 256);
            const yAxisHighByte = Math.floor(sh.yAxisID / 256);

            // ========== Length 450: Start of injection (SOI) - 15x15 ==========
            if (sh.length === 450) {
                if (sh.xAxisLength === 15 && sh.yAxisLength === 15) {
                    if (xAxisHighByte === 0xE0 && yAxisHighByte === 0xFC) {
                        sh.category = "Detected maps";
                        sh.subcategory = "Fuel";
                        const soiCount = this.getMapNameCountForCodeBlock("Start of injection (SOI)", sh.codeBlock, newSymbols);
                        sh.varname = `Start of injection (SOI) 0 °C [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                        sh.yAxisDescr = "Engine speed (rpm)";
                        sh.yaxisUnits = "rpm";
                        sh.xAxisCorrection = 0.01;
                        sh.xaxisUnits = "mg/st";
                        sh.xAxisDescr = "IQ (mg/stroke)";
                        sh.correction = 0.023437;
                        sh.zAxisDescr = "Start position (degrees BTDC)";
                    }
                }
            }

            // ========== Length 312: EGR - 13x12 ==========
            else if (sh.length === 312) {
                if (sh.xAxisLength === 13 && sh.yAxisLength === 12) {
                    if (xAxisHighByte === 0xE0 && yAxisHighByte === 0xDD) {
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

            // ========== Length 208: Driver wish - 13x8 ==========
            else if (sh.length === 208) {
                if (sh.xAxisLength === 13 && sh.yAxisLength === 8) {
                    if (xAxisHighByte === 0xE0 && yAxisHighByte === 0xC1) {
                        sh.category = "Detected maps";
                        sh.subcategory = "Misc";
                        sh.varname = `Driver wish [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                        sh.correction = 0.01;
                        sh.xAxisCorrection = 0.01;
                        sh.xAxisDescr = "Throttle position";
                        sh.zAxisDescr = "Requested IQ (mg)";
                        sh.yAxisDescr = "Engine speed (rpm)";
                        sh.yaxisUnits = "rpm";
                        sh.xaxisUnits = "TPS %";
                    }
                }
            }

            // ========== Length 182: Driver wish - 7x13 ==========
            else if (sh.length === 182) {
                if (xAxisHighByte === 0xE0 && yAxisHighByte === 0xC1) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Misc";
                    sh.varname = `Driver wish [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.correction = 0.01;
                    sh.xAxisCorrection = 0.01;
                    sh.xAxisDescr = "Throttle position";
                    sh.zAxisDescr = "Requested IQ (mg)";
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.yaxisUnits = "rpm";
                    sh.xaxisUnits = "TPS %";
                }
            }

            // ========== Length 176: Smoke limiter - 11x8 ==========
            else if (sh.length === 176) {
                if (sh.xAxisLength === 11 && sh.yAxisLength === 8) {
                    if (xAxisHighByte === 0xE0 && yAxisHighByte === 0xC2) {
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
                    }
                }
            }

            // ========== Length 40: Torque limiter - 20x1 ==========
            else if (sh.length === 40) {
                if (sh.xAxisLength === 20 && sh.yAxisLength === 1) {
                    if (xAxisHighByte === 0xE0) {
                        sh.category = "Detected maps";
                        sh.subcategory = "Limiters";
                        const lmCount = this.getMapNameCountForCodeBlock("Torque limiter", sh.codeBlock, newSymbols);
                        sh.varname = `Torque limiter (${lmCount}) [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                        sh.zAxisDescr = "Maximum IQ (mg)";
                        sh.yAxisDescr = "Engine speed (rpm)";
                        sh.correction = 0.01;
                        sh.yaxisUnits = "rpm";
                    }
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

    // ==================== SVBL Detection ====================
    private findSVBL(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        let found = true;
        let offset = 0;
        // EDC15M SVBL sequence: DF 7A 28 00 00 00 00 00 DF 7A
        const svblSeq = [0xDF, 0x7A, 0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0xDF, 0x7A];
        const mask = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
        const mapMafSeq = [0x41, 0x02, 0xFF, 0xFF, 0x00, 0x01, 0x01, 0x00];
        const mapMafMask = [1, 1, 0, 0, 1, 1, 1, 1];

        while (found) {
            const svblAddress = Tools.findSequence(allBytes, offset, svblSeq, mask);
            if (svblAddress > 0) {
                const shsvbl = this.createSymbolHelper();
                shsvbl.category = "Detected maps";
                shsvbl.subcategory = "Limiters";
                shsvbl.flashStartAddress = svblAddress - 2;

                // Check if value = 0xC3 0x00 -> two more back
                if (shsvbl.flashStartAddress >= 2) {
                    const testValue = Tools.readUint16(allBytes, shsvbl.flashStartAddress, true);
                    if (testValue === 0xC300) shsvbl.flashStartAddress -= 2;
                }

                shsvbl.varname = `SVBL Boost limiter [${this.determineCodeBlockDescription(shsvbl.flashStartAddress, newCodeBlocks)}]`;
                shsvbl.length = 2;
                shsvbl.codeBlock = this.determineCodeBlockByAddress(shsvbl.flashStartAddress, newCodeBlocks);
                newSymbols.push(shsvbl);

                // Search for MAP/MAF switch near SVBL
                const MAPMAFSwitch = Tools.findSequence(allBytes, Math.max(0, svblAddress - 0x100), mapMafSeq, mapMafMask);
                if (MAPMAFSwitch > 0) {
                    const mapMafAddr = MAPMAFSwitch + 2;
                    const mapmafsh = this.createSymbolHelper();
                    mapmafsh.flashStartAddress = mapMafAddr;
                    mapmafsh.length = 2;
                    mapmafsh.varname = `MAP/MAF switch (0 = MAF, 257/0x101 = MAP) [${this.determineCodeBlockDescription(mapMafAddr, newCodeBlocks)}]`;
                    mapmafsh.description = "Controls whether ECU uses MAP or MAF sensor";
                    mapmafsh.category = "Detected maps";
                    mapmafsh.subcategory = "Switches";
                    mapmafsh.zAxisDescr = "0 = MAF, 257 = MAP";
                    mapmafsh.codeBlock = this.determineCodeBlockByAddress(mapMafAddr, newCodeBlocks);
                    newSymbols.push(mapmafsh);
                }

                offset = svblAddress + 1;
            } else {
                found = false;
            }
        }
    }

    // ==================== Axis Helpers ====================
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
                        break;
                    }
                }
            }
        }
    }
}
