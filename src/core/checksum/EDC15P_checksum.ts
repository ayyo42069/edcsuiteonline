import { Tools } from "../tools";

export enum ChecksumResult {
    ChecksumOK,
    ChecksumFail,
    ChecksumTypeError,
    ChecksumUpdated
}

export class EDC15P_checksum {
    private chk_match: number = 0;
    private chk_found: number = 0;
    private chk_fixed: number = 0;

    public get ChecksumsMatch(): number {
        return this.chk_match;
    }

    public get ChecksumsFound(): number {
        return this.chk_found;
    }

    public get ChecksumsIncorrect(): number {
        return this.chk_fixed;
    }

    private checkEmpty(file_buffer: Uint8Array, chk_start_addr: number, chk_end_addr: number): boolean {
        for (let i = chk_start_addr; i < chk_end_addr - 4; i++) {
            if (file_buffer[i] !== 0xC3) return false;
        }
        return true;
    }

    public tdi41_checksum_search(file_buffer: Uint8Array, file_size: number): ChecksumResult {
        let first_pass = true;
        let chk_oldvalue: number, chk_value: number, chk_start_addr: number, chk_end_addr: number;
        const chk_array = [0x10000, 0x14000, 0x4C000, 0x50000, 0x50B80, 0x5C000, 0x60000, 0x60B80, 0x6C000, 0x70000, 0x70B80, 0x7C000];
        let seed_a = 0, seed_b = 0;

        this.chk_found = 0;
        this.chk_fixed = 0;
        this.chk_match = 0;

        for (; this.chk_found < chk_array.length - 1; this.chk_found++) {
            chk_start_addr = chk_array[this.chk_found];
            chk_end_addr = chk_array[this.chk_found + 1];

            if (!first_pass) {
                seed_a = (seed_a | 0x8631) & 0xFFFF;
                seed_b = (seed_b | 0xEFCD) & 0xFFFF;
            }

            // if (this.checkEmpty(file_buffer, chk_start_addr, chk_end_addr)) continue;

            chk_oldvalue = ((file_buffer[chk_end_addr - 1] << 24) |
                (file_buffer[chk_end_addr - 2] << 16) |
                (file_buffer[chk_end_addr - 3] << 8) |
                file_buffer[chk_end_addr - 4]) >>> 0;

            chk_value = this.tdi41_checksum_calculate(file_buffer, chk_start_addr, chk_end_addr - 4, seed_a, seed_b);

            if (chk_oldvalue !== chk_value && chk_oldvalue !== 0xC3C3C3C3) {
                file_buffer[chk_end_addr - 4] = (chk_value & 0xFF);
                file_buffer[chk_end_addr - 3] = ((chk_value >> 8) & 0xFF);
                file_buffer[chk_end_addr - 2] = ((chk_value >> 16) & 0xFF);
                file_buffer[chk_end_addr - 1] = ((chk_value >> 24) & 0xFF);
                this.chk_fixed++;
            } else if (chk_oldvalue === chk_value) {
                this.chk_match++;
            }
            first_pass = false;
        }

        if (this.chk_fixed === 0) return ChecksumResult.ChecksumOK;
        else if (this.chk_match > 3) return ChecksumResult.ChecksumFail; // Original logic returned Fail if fixed > 0 and match > 3? wait.
        // Original: if (chk_fixed == 0) OK; else if (chk_match > 3) Fail; else if (chk_fixed >= 6) TypeErr; return Fail.
        // The logic implies if we fixed some, but matched many, it might be a mixed file or partial fail, but "Fail" is the result.
        // We'll stick to original return types.

        if (this.chk_fixed === 0) return ChecksumResult.ChecksumOK;
        if (this.chk_match > 3) return ChecksumResult.ChecksumFail;
        if (this.chk_fixed >= 6) return ChecksumResult.ChecksumTypeError;
        return ChecksumResult.ChecksumFail;
    }

    public tdi41v2_checksum_search(file_buffer: Uint8Array, file_size: number): ChecksumResult {
        let first_pass = true;
        let chk_oldvalue: number, chk_value: number, chk_start_addr: number, chk_end_addr: number;
        const chk_array = [0x10000, 0x14000, 0x58000, 0x58B80, 0x64000, 0x70000, 0x70B80, 0x7C000];
        let seed_a = 0, seed_b = 0;

        this.chk_found = 0;
        this.chk_fixed = 0;
        this.chk_match = 0;

        for (; this.chk_found < chk_array.length - 1; this.chk_found++) {
            chk_start_addr = chk_array[this.chk_found];
            chk_end_addr = chk_array[this.chk_found + 1];

            if (!first_pass) {
                seed_a = (seed_a | 0x8631) & 0xFFFF;
                seed_b = (seed_b | 0xEFCD) & 0xFFFF;
            }

            if (this.checkEmpty(file_buffer, chk_start_addr, chk_end_addr)) continue;

            chk_oldvalue = ((file_buffer[chk_end_addr - 1] << 24) |
                (file_buffer[chk_end_addr - 2] << 16) |
                (file_buffer[chk_end_addr - 3] << 8) |
                file_buffer[chk_end_addr - 4]) >>> 0;

            chk_value = this.tdi41_checksum_calculate(file_buffer, chk_start_addr, chk_end_addr - 4, seed_a, seed_b);

            if (chk_oldvalue !== chk_value && chk_oldvalue !== 0xC3C3C3C3) {
                file_buffer[chk_end_addr - 4] = (chk_value & 0xFF);
                file_buffer[chk_end_addr - 3] = ((chk_value >> 8) & 0xFF);
                file_buffer[chk_end_addr - 2] = ((chk_value >> 16) & 0xFF);
                file_buffer[chk_end_addr - 1] = ((chk_value >> 24) & 0xFF);
                this.chk_fixed++;
            } else if (chk_value === chk_oldvalue) {
                this.chk_match++;
            }
            first_pass = false;
        }

        if (this.chk_fixed === 0) return ChecksumResult.ChecksumOK;
        if (this.chk_match > 3) return ChecksumResult.ChecksumFail;
        if (this.chk_fixed >= 4) return ChecksumResult.ChecksumTypeError;
        return ChecksumResult.ChecksumFail;
    }

    private tdi41_checksum_calculate(file_buffer: Uint8Array, chk_start_addr: number, chk_end_addr: number, seed_a: number, seed_b: number): number {
        let var_1: number;
        let var_2: number;

        // Ensure seeds are 16-bit
        seed_a &= 0xFFFF;
        seed_b &= 0xFFFF;

        do {
            var_2 = 0;
            
            // seed_a ^= Convert.ToUInt16((((UInt16)file_buffer[chk_start_addr + 1] << 8) + (UInt16)file_buffer[chk_start_addr]));
            const val1 = (file_buffer[chk_start_addr + 1] << 8) | file_buffer[chk_start_addr];
            seed_a = (seed_a ^ val1) & 0xFFFF;
            
            chk_start_addr += 2;

            if ((seed_b & 0xF) > 0) {
                // var_1 = Convert.ToUInt16(seed_a >> (16 - (seed_b & 0xF)));
                var_1 = (seed_a >>> (16 - (seed_b & 0xF))) & 0xFFFF;
                
                // seed_a <<= (seed_b & 0xF);
                seed_a = (seed_a << (seed_b & 0xF)) & 0xFFFF;
                
                // seed_a |= var_1;
                seed_a = (seed_a | var_1) & 0xFFFF;

                // var_2 = Convert.ToByte(seed_a & 1);
                var_2 = (seed_a & 1);
            }

            // seed_b -= Convert.ToUInt16((((UInt16)file_buffer[chk_start_addr + 1] << 8) + (UInt16)file_buffer[chk_start_addr]));
            const val2 = (file_buffer[chk_start_addr + 1] << 8) | file_buffer[chk_start_addr];
            seed_b = (seed_b - val2) & 0xFFFF;
            
            // seed_b -= var_2;
            seed_b = (seed_b - var_2) & 0xFFFF;
            
            chk_start_addr += 2;
            // seed_b ^= seed_a;
            seed_b = (seed_b ^ seed_a) & 0xFFFF;

            if (chk_start_addr === chk_end_addr)
                break;

            // seed_a -= Convert.ToUInt16((((UInt16)file_buffer[chk_start_addr + 1] << 8) + (UInt16)file_buffer[chk_start_addr]));
            const val3 = (file_buffer[chk_start_addr + 1] << 8) | file_buffer[chk_start_addr];
            seed_a = (seed_a - val3) & 0xFFFF;

            chk_start_addr += 2;
            // seed_a += 0xDAAC;
            seed_a = (seed_a + 0xDAAC) & 0xFFFF;

            // seed_b ^= Convert.ToUInt16((((UInt16)file_buffer[chk_start_addr + 1] << 8) + (UInt16)file_buffer[chk_start_addr]));
            const val4 = (file_buffer[chk_start_addr + 1] << 8) | file_buffer[chk_start_addr];
            seed_b = (seed_b ^ val4) & 0xFFFF;
            
            chk_start_addr += 2;

            if ((seed_a & 0xF) > 0) {
                // var_1 = Convert.ToUInt16((seed_b << (16 - (seed_a & 0xF))) & 0xffff);
                var_1 = (seed_b << (16 - (seed_a & 0xF))) & 0xFFFF;
                
                // seed_b >>= (seed_a & 0xF);
                seed_b = (seed_b >>> (seed_a & 0xF)) & 0xFFFF;
                
                // seed_b |= var_1;
                seed_b = (seed_b | var_1) & 0xFFFF;
            }
        }
        while (chk_start_addr !== chk_end_addr);

        seed_a = (seed_a - 0x8631) & 0xFFFF;
        seed_a = (seed_a + 0xDAAC) & 0xFFFF;
        seed_b = (seed_b ^ 0xDF9B) & 0xFFFF;

        return (((seed_b << 16) >>> 0) + seed_a) >>> 0;
    }

    public tdi41_2002_checksum_search(file_buffer: Uint8Array, file_size: number): ChecksumResult {
        let seed_1: number, seed_2: number;
        let seed_1_msb: number, seed_1_lsb: number, seed_2_lsb: number, seed_2_msb: number;
        let chk_oldvalue: number, chk_value: number, chk_start_addr: number, chk_end_addr: number, chk_store_addr: number;

        this.chk_found = 2;
        this.chk_fixed = 0;
        this.chk_match = 0;

        // Find seed 1
        seed_1 = this.tdi41_2002_checksum_calculate(file_buffer, 0x14000, 0x4bffe, 0x8631, 0xefcd, 0, 0, true);
        seed_1_msb = (seed_1 >>> 16) & 0xFFFF;
        seed_1_lsb = seed_1 & 0xFFFF;

        // Find seed 2
        seed_2 = this.tdi41_2002_checksum_calculate(file_buffer, 0, 0x7ffe, 0, 0, 0, 0, true);
        seed_2_msb = (seed_2 >>> 16) & 0xFFFF;
        seed_2_lsb = seed_2 & 0xFFFF;

        // Checksum 1
        chk_oldvalue = ((file_buffer[0xffff] << 24) |
            (file_buffer[0xfffe] << 16) |
            (file_buffer[0xfffd] << 8) |
            file_buffer[0xfffc]) >>> 0;

        chk_value = this.tdi41_2002_checksum_calculate(file_buffer, 0x8000, 0xfffb, seed_2_lsb, seed_2_msb, 0x4531, 0x3550, false);

        if (chk_oldvalue !== chk_value) {
            file_buffer[0xfffc] = (chk_value & 0xFF);
            file_buffer[0xfffd] = ((chk_value >> 8) & 0xFF);
            file_buffer[0xfffe] = ((chk_value >> 16) & 0xFF);
            file_buffer[0xffff] = ((chk_value >> 24) & 0xFF);
            this.chk_fixed++;
        } else this.chk_match++;

        // Checksum 2
        chk_oldvalue = ((file_buffer[0x13fff] << 24) |
            (file_buffer[0x13ffe] << 16) |
            (file_buffer[0x13ffd] << 8) |
            file_buffer[0x13ffc]) >>> 0;

        chk_value = this.tdi41_2002_checksum_calculate(file_buffer, 0x10000, 0x13ffb, 0, 0, 0x8631, 0xefcd, false);

        if (chk_oldvalue !== chk_value) {
            file_buffer[0x13ffc] = (chk_value & 0xFF);
            file_buffer[0x13ffd] = ((chk_value >> 8) & 0xFF);
            file_buffer[0x13ffe] = ((chk_value >> 16) & 0xFF);
            file_buffer[0x13fff] = ((chk_value >> 24) & 0xFF);
            this.chk_fixed++;
        } else this.chk_match++;

        // Checksum blocks loop
        chk_store_addr = 0x4fffb;
        do {
            if ((file_buffer[chk_store_addr + 13] === 0x56) &&
                (file_buffer[chk_store_addr + 14] === 0x34) &&
                (file_buffer[chk_store_addr + 15] === 0x2e) &&
                (file_buffer[chk_store_addr + 16] === 0x31)) {
                
                // Checksum
                chk_start_addr = chk_store_addr - 0x3ffb;
                chk_end_addr = chk_store_addr;

                chk_oldvalue = ((file_buffer[chk_store_addr + 4] << 24) |
                    (file_buffer[chk_store_addr + 3] << 16) |
                    (file_buffer[chk_store_addr + 2] << 8) |
                    file_buffer[chk_store_addr + 1]) >>> 0;

                chk_value = this.tdi41_2002_checksum_calculate(file_buffer, chk_start_addr, chk_end_addr, seed_1_lsb, seed_1_msb, seed_1_lsb, seed_1_msb, false);

                if (chk_oldvalue !== chk_value) {
                    file_buffer[chk_store_addr + 1] = (chk_value & 0xFF);
                    file_buffer[chk_store_addr + 2] = ((chk_value >> 8) & 0xFF);
                    file_buffer[chk_store_addr + 3] = ((chk_value >> 16) & 0xFF);
                    file_buffer[chk_store_addr + 4] = ((chk_value >> 24) & 0xFF);
                    this.chk_fixed++;
                } else this.chk_match++;

                // Checksum
                chk_start_addr = chk_store_addr + 5;
                chk_end_addr = chk_store_addr + 0xb80;

                chk_oldvalue = ((file_buffer[chk_store_addr + 2948] << 24) |
                    (file_buffer[chk_store_addr + 2947] << 16) |
                    (file_buffer[chk_store_addr + 2946] << 8) |
                    file_buffer[chk_store_addr + 2945]) >>> 0;

                chk_value = this.tdi41_2002_checksum_calculate(file_buffer, chk_start_addr, chk_end_addr, seed_1_lsb, seed_1_msb, seed_1_lsb, seed_1_msb, false);

                if (chk_oldvalue !== chk_value) {
                    file_buffer[chk_store_addr + 2945] = (chk_value & 0xFF);
                    file_buffer[chk_store_addr + 2946] = ((chk_value >> 8) & 0xFF);
                    file_buffer[chk_store_addr + 2947] = ((chk_value >> 16) & 0xFF);
                    file_buffer[chk_store_addr + 2948] = ((chk_value >> 24) & 0xFF);
                    this.chk_fixed++;
                } else this.chk_match++;

                // Checksum
                chk_start_addr = chk_store_addr + 0xb85;
                chk_end_addr = chk_store_addr + 0xc000;

                chk_oldvalue = ((file_buffer[chk_store_addr + 49156] << 24) |
                    (file_buffer[chk_store_addr + 49155] << 16) |
                    (file_buffer[chk_store_addr + 49154] << 8) |
                    file_buffer[chk_store_addr + 49153]) >>> 0;

                chk_value = this.tdi41_2002_checksum_calculate(file_buffer, chk_start_addr, chk_end_addr, seed_1_lsb, seed_1_msb, seed_1_lsb, seed_1_msb, false);

                if (chk_oldvalue !== chk_value) {
                    file_buffer[chk_store_addr + 49153] = (chk_value & 0xFF);
                    file_buffer[chk_store_addr + 49154] = ((chk_value >> 8) & 0xFF);
                    file_buffer[chk_store_addr + 49155] = ((chk_value >> 16) & 0xFF);
                    file_buffer[chk_store_addr + 49156] = ((chk_value >> 24) & 0xFF);
                    this.chk_fixed++;
                } else this.chk_match++;

                this.chk_found += 3;
            }

            chk_store_addr += 0x10000;
        } while (chk_store_addr + 5 < file_size);

        if (this.chk_fixed === 0) return ChecksumResult.ChecksumOK;
        if (this.chk_match > 3) return ChecksumResult.ChecksumFail;
        if (this.chk_fixed >= this.chk_found - 1) return ChecksumResult.ChecksumTypeError;
        return ChecksumResult.ChecksumFail;
    }

    private tdi41_2002_checksum_calculate(file_buffer: Uint8Array, chk_start_addr: number, chk_end_addr: number, seed_a: number, seed_b: number, seed_c: number, seed_d: number, first_pass: boolean): number {
        let count = Math.floor(chk_start_addr / 2);
        let end_count = Math.floor(chk_end_addr / 2);
        let buffer_addr = chk_start_addr;
        let checksum: number, var_6: number, var_7: number = 0;
        let var_1: number = 0, var_2: number = 0, var_3: number, var_4: number, var_5: number;

        seed_a &= 0xFFFF;
        seed_b &= 0xFFFF;
        seed_c &= 0xFFFF;
        seed_d &= 0xFFFF;

        if (count !== end_count) {
            var_1 = seed_a;
            var_2 = seed_b;

            if (chk_start_addr === 0x8000) {
                var_1 = (var_1 ^ 0xD565) & 0xFFFF;
                var_2 = (var_2 + 0x308a) & 0xFFFF;
            }

            do {
                const val1 = (file_buffer[buffer_addr + 1] << 8) | file_buffer[buffer_addr];
                var_1 = (var_1 ^ val1) & 0xFFFF;
                
                var_3 = (var_2 & 0xF);
                ++count;
                buffer_addr += 2;
                var_4 = 0;

                if ((var_2 & 0xF) > 0) {
                    do {
                        var_4 = (var_1 >>> 15) & 0xFFFF;
                        var_1 = (((var_1 * 2) + var_4)) & 0xFFFF;
                        --var_3;
                    } while (var_3 > 0);
                }

                const val2 = (file_buffer[buffer_addr + 1] << 8) | file_buffer[buffer_addr];
                var_2 = (var_2 - ((var_4 + val2))) & 0xFFFF;
                var_2 = (var_1 ^ var_2) & 0xFFFF;

                buffer_addr += 2;
                ++count;

                if (count > end_count) break;

                var_5 = ((file_buffer[buffer_addr + 1] << 8) + file_buffer[buffer_addr]) & 0xFFFF;
                buffer_addr += 4;
                
                var_1 = (var_1 + ((0xffff - var_5 + 0xdaad))) & 0xFFFF;
                
                var_6 = (file_buffer[buffer_addr - 1] << 8) >>> 0;
                var_2 = (var_2 ^ (var_6 + file_buffer[buffer_addr - 2])) & 0xFFFF;
                
                var_4 = (var_1 & 0xF);
                count += 2;

                if ((var_1 & 0xF) > 0) {
                    do {
                        var_6 = ((var_6 | 0xffff) & var_2) >>> 0;
                        var_6 = (var_6 << 15) >>> 0;
                        var_2 = ((var_2 >>> 1) + var_6) & 0xFFFF;
                        --var_4;
                    } while (var_4 > 0);
                }
            } while (count <= end_count);
        }

        if (chk_start_addr === 0) {
            var_1 = (var_1 - 0x79cf) & 0xFFFF;
            var_2 = (var_2 - 0x1033) & 0xFFFF;
        }

        if (!first_pass) {
            var_5 = seed_d;
            var_1 = (var_1 - seed_c) & 0xFFFF;
            var_6 = ((seed_c | 0xffff) & 0xdaad) & 0xFFFF;
            var_1 = (var_1 + (var_6 - 1)) & 0xFFFF;
            var_7 = var_7 & 0xFFFF;

            for (count = (seed_c & 0xF) >>> 0; count > 0; var_5 = (((var_5 >>> 15) + var_7) & 0xFFFF)) {
                --count;
                var_7 = ((var_7 | 0xffff) & var_5) & 0xFFFF;
                var_7 = (var_7 * 2) & 0xFFFF;
            }

            // checksum = (UInt32)(((UInt32)var_1 + (((UInt32)var_5 ^ (UInt32)var_2) << 16)));
            checksum = ((var_1 >>> 0) + ((((var_5 ^ var_2) >>> 0) << 16) >>> 0)) >>> 0;
        } else {
            // checksum = (UInt32)(((UInt32)var_1 + ((UInt32)var_2 << 16)));
            checksum = ((var_1 >>> 0) + ((var_2 << 16) >>> 0)) >>> 0;
        }

        return checksum;
    }
}
