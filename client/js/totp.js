/**
 * TOTP 生成器 - 纯前端实现
 */
class TOTPGenerator {
    static async generate(secret, digits = 6, period = 30) {
        const key = this.base32Decode(secret);
        if (!key || key.length === 0) return null;
        const now = Math.floor(Date.now() / 1000);
        const time = Math.floor(now / period);
        const timeBytes = this.int64ToBytes(time);
        const hmac = await this.hmacSha1(key, timeBytes);
        const offset = hmac[hmac.length - 1] & 0x0F;
        const code = this.extractCode(hmac, offset, digits);
        return code;
    }

    static getRemaining(digits = 6, period = 30) {
        return period - (Math.floor(Date.now() / 1000) % period);
    }

    static base32Decode(str) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        str = str.replace(/=+$/, '').toUpperCase();
        let bits = '';
        for (const ch of str) {
            const val = chars.indexOf(ch);
            if (val < 0) return null;
            bits += val.toString(2).padStart(5, '0');
        }
        const bytes = [];
        for (let i = 0; i + 8 <= bits.length; i += 8) {
            bytes.push(parseInt(bits.substr(i, 8), 2));
        }
        return new Uint8Array(bytes);
    }

    static async hmacSha1(key, data) {
        const cryptoKey = await crypto.subtle.importKey(
            'raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
        );
        const sig = await crypto.subtle.sign('HMAC', cryptoKey, data);
        return new Uint8Array(sig);
    }

    static int64ToBytes(n) {
        const buf = new ArrayBuffer(8);
        new DataView(buf).setBigUint64(0, BigInt(n));
        return new Uint8Array(buf);
    }

    static extractCode(hash, offset, digits) {
        const code = ((hash[offset] & 0x7F) << 24) |
                     ((hash[offset + 1] & 0xFF) << 16) |
                     ((hash[offset + 2] & 0xFF) << 8) |
                     (hash[offset + 3] & 0xFF);
        return (code % Math.pow(10, digits)).toString().padStart(digits, '0');
    }
}
