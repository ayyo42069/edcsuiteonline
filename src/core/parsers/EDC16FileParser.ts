import { SymbolHelper, CodeBlock, AxisHelper, GearboxType, MapSelector, EDCFileType, SymbolCollection } from '../types';
import { Tools } from '../tools';
import { PartNumberConverter } from '../partNumberConverter';

/**
 * Parser for EDC16 ECU variants
 * Uses different map detection: LL LL AXIS AXIS MAPDATA format
 * Based on C# EDC16FileParser.cs with inline map detection
 */
export class EDC16FileParser {

    public parseFile(fileBuffer: ArrayBuffer): { symbols: SymbolCollection, codeBlocks: CodeBlock[], axisHelpers: AxisHelper[] } {
        const allBytes = new Uint8Array(fileBuffer);
        const newCodeBlocks: CodeBlock[] = [];
        const newAxisHelpers: AxisHelper[] = [];
        const newSymbols: SymbolCollection = [];

        // EDC16 uses LL LL AXIS AXIS MAPDATA format
        for (let i = 0; i < allBytes.length - 32; i += 2) {
            const len2Skip = this.checkMap(i, allBytes, newSymbols, newCodeBlocks);
            if ((len2Skip % 2) > 0) {
                if (len2Skip > 2) i += len2Skip - 1;
                else i += len2Skip;
            } else {
                i += len2Skip;
            }
        }

        // Sort symbols
        newSymbols.sort((a, b) => a.flashStartAddress - b.flashStartAddress);

        this.nameKnownMaps(allBytes, newSymbols, newCodeBlocks);
        this.findSVBL(allBytes, newSymbols, newCodeBlocks);

        return { symbols: newSymbols, codeBlocks: newCodeBlocks, axisHelpers: newAxisHelpers };
    }

    private checkMap(t: number, allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): number {
        let retval = 0;

        // EDC16 format: Read LL LL (lengths as big-endian)
        const len1 = allBytes[t] * 256 + allBytes[t + 1];
        const len2 = allBytes[t + 2] * 256 + allBytes[t + 3];

        if (len1 < 32 && len2 < 32 && len1 > 0 && len2 > 0) {
            const sh = this.createSymbolHelper();
            sh.xAxisAddress = t + 4;
            sh.xAxisLength = len1;
            sh.yAxisAddress = sh.xAxisAddress + sh.xAxisLength * 2;
            sh.yAxisLength = len2;
            sh.flashStartAddress = sh.yAxisAddress + sh.yAxisLength * 2;
            sh.length = sh.xAxisLength * sh.yAxisLength * 2;

            if (sh.xAxisLength > 1 && sh.yAxisLength > 1) {
                sh.varname = `3D ${sh.flashStartAddress.toString(16).toUpperCase().padStart(8, '0')}`;
                sh.is3D = true;
            } else {
                sh.varname = `2D ${sh.flashStartAddress.toString(16).toUpperCase().padStart(8, '0')}`;
                sh.is2D = true;
            }

            this.addToSymbolCollection(newSymbols, sh, newCodeBlocks);
            retval = (len1 + len2) * 2 + sh.length;
        }
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
                if (cb.codeID === 1) return "codeblock 1";
                if (cb.codeID === 2) return "codeblock 2";
                if (cb.codeID === 3) return "codeblock 3";
                return cb.codeID.toString();
            }
        }
        return `flashbank ${Math.floor(address / 0x10000)}`;
    }

    private getMaxAxisValue(allBytes: Uint8Array, sh: SymbolHelper, axis: 'X' | 'Y'): number {
        let retval = 0;
        if (axis === 'X') {
            let offset = sh.xAxisAddress;
            for (let i = 0; i < sh.xAxisLength; i++) {
                const val = allBytes[offset + 1] + allBytes[offset] * 256;
                if (val > retval) retval = val;
                offset += 2;
            }
        } else {
            let offset = sh.yAxisAddress;
            for (let i = 0; i < sh.yAxisLength; i++) {
                const val = allBytes[offset + 1] + allBytes[offset] * 256;
                if (val > retval) retval = val;
                offset += 2;
            }
        }
        return retval;
    }

    private collectionContainsMapInSize(newSymbols: SymbolCollection, ysize: number, xsize: number): boolean {
        for (const sh of newSymbols) {
            if (sh.yAxisLength === ysize && sh.xAxisLength === xsize) return true;
        }
        return false;
    }

    // ==================== EDC16 Map Detection ====================
    private nameKnownMaps(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        for (const sh of newSymbols) {

            // ========== 4x20: Torque limiter ==========
            if (sh.xAxisLength === 4 && sh.yAxisLength === 20) {
                sh.category = "Detected maps";
                sh.subcategory = "Limiters";
                sh.varname = `Torque limiter [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                sh.zAxisDescr = "Maximum IQ (mg)";
                sh.yAxisDescr = "Engine speed (rpm)";
                sh.correction = 0.01;
                sh.yaxisUnits = "rpm";
            }

            // ========== 4x21: Torque limiter ==========
            else if (sh.xAxisLength === 4 && sh.yAxisLength === 21) {
                sh.category = "Detected maps";
                sh.subcategory = "Limiters";
                sh.varname = `Torque limiter [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                sh.zAxisDescr = "Maximum IQ (mg)";
                sh.yAxisDescr = "Engine speed (rpm)";
                sh.correction = 0.01;
                sh.yaxisUnits = "rpm";
            }

            // ========== 3x21: Torque limiter (alternative) ==========
            else if (sh.xAxisLength === 3 && sh.yAxisLength === 21) {
                if (!this.collectionContainsMapInSize(newSymbols, 21, 4)) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Limiters";
                    sh.varname = `Torque limiter [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.zAxisDescr = "Maximum IQ (mg)";
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.correction = 0.01;
                    sh.yaxisUnits = "rpm";
                }
            }

            // ========== 16x8: Driver wish ==========
            else if (sh.xAxisLength === 16 && sh.yAxisLength === 8) {
                sh.category = "Detected maps";
                sh.subcategory = "Misc";
                const dwCount = this.getMapNameCountForCodeBlock("Driver wish ", sh.codeBlock, newSymbols);
                sh.varname = `Driver wish (${dwCount}) [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                sh.correction = 0.01;
                sh.xAxisCorrection = 0.01;
                sh.xAxisDescr = "Throttle position";
                sh.zAxisDescr = "Requested IQ (mg)";
                sh.yAxisDescr = "Engine speed (rpm)";
                sh.yaxisUnits = "rpm";
                sh.xaxisUnits = "TPS %";
            }

            // ========== 15x16: IQ to Torque conversion ==========
            else if (sh.xAxisLength === 15 && sh.yAxisLength === 16) {
                sh.category = "Detected maps";
                sh.subcategory = "Misc";
                sh.varname = `IQ to Torque conversion [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                sh.correction = 0.01;
                sh.xAxisCorrection = 0.1;
                sh.xAxisDescr = "Torque";
                sh.zAxisDescr = "IQ (mg)";
                sh.yAxisDescr = "Engine speed (rpm)";
                sh.yaxisUnits = "rpm";
                sh.xaxisUnits = "Nm";
            }

            // ========== 11x10: Boost limit map ==========
            else if (sh.xAxisLength === 11 && sh.yAxisLength === 10) {
                sh.category = "Detected maps";
                sh.subcategory = "Limiters";
                sh.varname = `Boost limit map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                sh.xAxisDescr = "Atmospheric pressure (mbar)";
                sh.zAxisDescr = "Maximum boost pressure (mbar)";
                sh.yAxisDescr = "Engine speed (rpm)";
                sh.yaxisUnits = "rpm";
                sh.xaxisUnits = "mbar";
            }

            // ========== 19x15: Injector duration ==========
            else if (sh.xAxisLength === 19 && sh.yAxisLength === 15) {
                sh.category = "Detected maps";
                sh.subcategory = "Fuel";
                const injDurCount = this.getMapNameCountForCodeBlock("Injector duration", sh.codeBlock, newSymbols);
                sh.varname = `Injector duration ${String(injDurCount).padStart(2, '0')} [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                sh.yAxisCorrection = 0.01;
                sh.correction = 0.023437;
                sh.xAxisDescr = "Engine speed (rpm)";
                sh.yAxisDescr = "Requested Quantity mg/stroke";
                sh.zAxisDescr = "Duration (crankshaft degrees)";
                sh.xaxisUnits = "rpm";
                sh.yaxisUnits = "mg/st";
            }

            // ========== 16x12: Smoke limiter ==========
            else if (sh.xAxisLength === 16 && sh.yAxisLength === 12) {
                if (this.getMaxAxisValue(allBytes, sh, 'Y') < 4000) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Limiters";
                    sh.varname = `Smoke limiter [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.zAxisDescr = "Maximum IQ (mg)";
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.xAxisDescr = "Manifold pressure (mbar)";
                    sh.correction = 0.01;
                    sh.yaxisUnits = "rpm";
                    sh.xaxisUnits = "mbar";
                }
            }

            // ========== 16x14: Start of injection (SOI) ==========
            else if (sh.xAxisLength === 16 && sh.yAxisLength === 14) {
                sh.category = "Detected maps";
                sh.subcategory = "Fuel";
                const soiCount = this.getMapNameCountForCodeBlock("Start of injection (SOI)", sh.codeBlock, newSymbols);
                sh.varname = `Start of injection (SOI) ${soiCount} [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                sh.correction = 0.023437;
                sh.yAxisDescr = "Engine speed (rpm)";
                sh.yaxisUnits = "rpm";
                sh.xAxisCorrection = 0.01;
                sh.xaxisUnits = "mg/st";
                sh.xAxisDescr = "IQ (mg/stroke)";
                sh.zAxisDescr = "Start position (degrees BTDC)";
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

    // ==================== SVBL Detection (empty for EDC16) ====================
    private findSVBL(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        // EDC16 doesn't have SVBL detection in the C# implementation
    }
}
