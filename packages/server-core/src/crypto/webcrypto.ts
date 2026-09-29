const V2_SALT = "subboost:encrypted-field:v2";
const V2_INFO = "subboost:aes-256-gcm:v2";

function hexToBytes(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/i.test(value)) throw new Error("Invalid encrypted field encoding");
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function concatBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
  const result = new Uint8Array(first.length + second.length);
  result.set(first);
  result.set(second, first.length);
  return result;
}

export async function decryptEncryptedFieldV2WebCrypto(
  ciphertext: string,
  masterKey: string,
): Promise<string> {
  if (!masterKey.trim()) throw new Error("Encryption master key is required");
  const [version, ivHex, tagHex, encryptedHex, ...extra] = ciphertext.split(":");
  if (version !== "v2" || !ivHex || !tagHex || encryptedHex === undefined || extra.length > 0) {
    throw new Error("Invalid ciphertext v2 format");
  }
  if (!/^[0-9a-f]{24}$/i.test(ivHex) || !/^[0-9a-f]{32}$/i.test(tagHex)) {
    throw new Error("Invalid ciphertext v2 metadata");
  }

  const rawMasterKey = new TextEncoder().encode(masterKey);
  const keyMaterial = await crypto.subtle.importKey("raw", rawMasterKey, "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(V2_SALT),
      info: new TextEncoder().encode(V2_INFO),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const iv = hexToBytes(ivHex);
  const encryptedWithTag = concatBytes(hexToBytes(encryptedHex), hexToBytes(tagHex));
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, encryptedWithTag);
  return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
}
