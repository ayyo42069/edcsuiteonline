import { CodeBlock, AxisHelper, SymbolCollection } from '../types';

export abstract class IEDCFileParser {
    abstract parseFile(filename: string, allBytes: Uint8Array): { newCodeBlocks: CodeBlock[], newAxisHelpers: AxisHelper[], newSymbols: SymbolCollection };
    abstract extractBoschPartNumber(allBytes: Uint8Array): string;
    abstract extractSoftwareNumber(allBytes: Uint8Array): string;
    abstract extractPartNumber(allBytes: Uint8Array): string;
    abstract extractInfo(allBytes: Uint8Array): string;
    // Phase 2 methods can be abstract or have default implementations
    // abstract nameKnownMaps(...): void;
    // abstract findSVBL(...): void;
}
