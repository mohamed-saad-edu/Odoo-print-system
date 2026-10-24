/** Test-only document corpus. No Agent renderer or printer transport runs here. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import sharp from "sharp";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const WORKLOAD_FORMAT_DISTRIBUTION = { rawReceipt: 50, jpegReceipt: 30, pdfDocument: 15, longJpegReceipt: 4, imageRichPdf: 1 };
export const SYNTHETIC_GEOMETRIES = [
  { printable_width_dots: 432, dpi_x: 203, dpi_y: 203, paper_width_mm: 58, offset_x_dots: 12 },
  { printable_width_dots: 832, dpi_x: 300, dpi_y: 300, paper_width_mm: 80, offset_x_dots: 16 },
  { printable_width_dots: 1664, dpi_x: 600, dpi_y: 600, paper_width_mm: 80, offset_x_dots: 32 },
];

export function syntheticPrinterProfile(printerId, index, observedAt = new Date().toISOString()) {
  const profile = { ...SYNTHETIC_GEOMETRIES[index % SYNTHETIC_GEOMETRIES.length] };
  const config = { spooler_name: `SYNTHETIC_NO_TRANSPORT_${index}`, geometry_profile: profile };
  // This is an explicit synthetic Agent observation, not a device measurement
  // or a claim to have executed the Go fingerprint implementation.
  const geometry = { version: 1, source: "validated_profile", validation: "configured", observed_at: observedAt,
    printer_id: printerId, config_fingerprint: sha256(JSON.stringify([printerId, "spooler", config])), ...profile };
  return { config, capabilities: { supported_protocols: ["raw", "pdf", "image"], geometry } };
}

function noiseBytes(width, height, seed) {
  const data = Buffer.alloc(width * height * 3);
  let state = seed >>> 0;
  for (let i = 0; i < data.length; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    data[i] = (state >>> 24) & 255;
  }
  return data;
}

async function receiptJpeg(width, long) {
  const height = long ? Math.min(12000, width * 10) : width * 2;
  const scale = width / 432;
  const rows = Math.floor((height / scale - 220) / 28);
  const text = Array.from({ length: rows }, (_, row) =>
    `<text x="18" y="${210 + row * 28}" font-size="13">${String(row + 1).padStart(3, "0")}  Item ${String(row * 7919 % 100000).padStart(5, "0")}    ${(1 + row % 9)} x ${(2.35 + row * .17).toFixed(2)}</text>`).join("");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 432 ${height / scale}"><rect width="432" height="${height / scale}" fill="white"/><g fill="#111" font-family="DejaVu Sans,sans-serif"><text x="18" y="30" font-size="20">YASEIR TEST RECEIPT</text><text x="414" y="58" text-anchor="end" font-size="18">فاتورة تجريبية</text><text x="18" y="83" font-size="12">Synthetic content: no customer or payment information</text><path d="M12 95H420" stroke="black"/>${text}<text x="18" y="${height / scale - 20}" font-size="12">END OF RECEIPT / ${width} device pixels</text></g></svg>`);
  // A bounded photographic/noise swatch makes compression materially different
  // from blank receipts or Buffer.alloc placeholders; content remains valid JPEG.
  const swatchWidth = width - Math.ceil(36 * scale);
  const swatchHeight = Math.ceil((long ? 140 : 80) * scale);
  const swatch = await sharp(noiseBytes(swatchWidth, swatchHeight, 0x13579bdf + width + Number(long)),
    { raw: { width: swatchWidth, height: swatchHeight, channels: 3 } }).png().toBuffer();
  const bytes = await sharp(svg).composite([{ input: swatch, left: Math.ceil(18 * scale), top: Math.ceil(102 * scale) }])
    .jpeg({ quality: 78, chromaSubsampling: "4:2:0" }).toBuffer();
  return { bytes, width, height, kind: long ? "longJpegReceipt" : "jpegReceipt", format: "image" };
}

function rawReceipt(variant) {
  const lines = ["YASEIR SYNTHETIC RAW RECEIPT", `Fixture ${variant} - plain ASCII, no peripheral commands`, "Qty  Product code  Unit price  Total"];
  for (let row = 0; row < 100 + variant * 3; row++) {
    const code = sha256(`receipt-${variant}-${row}`).slice(0, 16);
    lines.push(`${1 + row % 9}  ${code}  ${(2.25 + row * .19).toFixed(2)}  ${(3.15 + row * .41).toFixed(2)}`);
  }
  lines.push("END OF SYNTHETIC RECEIPT", "");
  return { bytes: Buffer.from(lines.join("\n")), kind: "rawReceipt", format: "raw" };
}

function pdfDocument(jpeg, { pages, media, kind }) {
  const [width, height] = media === "A5" ? [419.528, 595.276] : [595.276, 841.89];
  const objects = [null, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"), null,
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${jpeg.width} /Height ${jpeg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.bytes.length} >>\nstream\n`), jpeg.bytes, Buffer.from("\nendstream")]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")];
  const children = [];
  for (let page = 0; page < pages; page++) {
    const pageId = objects.length, contentId = pageId + 1;
    children.push(`${pageId} 0 R`);
    const imageWidth = width - 72, imageHeight = Math.min(height - 120, imageWidth * jpeg.height / jpeg.width);
    const content = Buffer.from(`BT /F1 14 Tf 36 ${height - 30} Td (Yaseir synthetic ${media} document - page ${page + 1}) Tj ET\nq ${imageWidth} 0 0 ${imageHeight} 36 ${height - 60 - imageHeight} cm /Image1 Do Q\nBT /F1 10 Tf 36 24 Td (No printer backend, no physical output claim) Tj ET`);
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Image1 3 0 R >> /Font << /F1 4 0 R >> >> /Contents ${contentId} 0 R >>`));
    objects.push(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from("\nendstream")]));
  }
  objects[2] = Buffer.from(`<< /Type /Pages /Count ${pages} /Kids [${children.join(" ")}] >>`);
  const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")], offsets = [0];
  let position = chunks[0].length;
  for (let id = 1; id < objects.length; id++) {
    offsets.push(position);
    const chunk = Buffer.concat([Buffer.from(`${id} 0 obj\n`), objects[id], Buffer.from("\nendobj\n")]);
    chunks.push(chunk); position += chunk.length;
  }
  chunks.push(Buffer.from(`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`));
  return { bytes: Buffer.concat(chunks), kind, format: "pdf", pages, media };
}

export async function createWorkloadCorpus() {
  const assets = [];
  for (let i = 0; i < 8; i++) assets.push({ id: `raw-${i}`, ...rawReceipt(i) });
  for (const profile of SYNTHETIC_GEOMETRIES) {
    for (const long of [false, true]) assets.push({ id: `jpeg-${profile.printable_width_dots}-${long ? "long" : "short"}`, ...await receiptJpeg(profile.printable_width_dots, long) });
  }
  assets.push({ id: "pdf-a4", ...pdfDocument(assets.find(a => a.id === "jpeg-832-short"), { pages: 2, media: "A4", kind: "pdfDocument" }) });
  assets.push({ id: "pdf-a5", ...pdfDocument(assets.find(a => a.id === "jpeg-432-short"), { pages: 1, media: "A5", kind: "pdfDocument" }) });
  const richWidth = 1600, richHeight = 1200;
  const richBytes = await sharp(noiseBytes(richWidth, richHeight, 0x71af29e3), { raw: { width: richWidth, height: richHeight, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
  assets.push({ id: "pdf-image-rich", ...pdfDocument({ bytes: richBytes, width: richWidth, height: richHeight }, { pages: 4, media: "A4", kind: "imageRichPdf" }) });
  for (const asset of assets) {
    assert(asset.bytes.length > 0 && asset.bytes.length <= 5 * 1024 * 1024, "Corpus must respect production payload bounds");
    asset.sha256 = sha256(asset.bytes); asset.base64 = asset.bytes.toString("base64");
    asset.gzipRatio = gzipSync(asset.bytes).length / asset.bytes.length;
  }
  return { assets, byId: new Map(assets.map(asset => [asset.id, asset])), manifest: assets.map(({ base64: _base64, bytes, ...asset }) => ({ ...asset, decodedBytes: bytes.length, encodedBytes: Buffer.byteLength(bytes.toString("base64")) })) };
}

export function workloadAsset(corpus, printer, index) {
  // Coprime permutation interleaves rare large documents, avoiding an artificial
  // block of large jobs at the end of each hundred-operation cycle.
  const bucket = index * 37 % 100;
  const width = printer.capabilities.geometry.printable_width_dots;
  const id = bucket < 50 ? `raw-${Math.floor(index / 6) % 8}` : bucket < 80 ? `jpeg-${width}-short`
    : bucket < 95 ? `pdf-a${Math.floor(index / 6) % 2 ? 5 : 4}` : bucket < 99 ? `jpeg-${width}-long` : "pdf-image-rich";
  const asset = corpus.byId.get(id); assert(asset, `Unknown synthetic payload ${id}`); return asset;
}

export function workloadPayload(asset, printer) {
  return { type: asset.format, ...(asset.format === "raw" ? { protocol: "raw" } : {}), encoding: "base64", data: asset.base64,
    ...(asset.format === "image" ? { geometry_fingerprint: printer.capabilities.geometry.config_fingerprint } : {}) };
}

export function verifyPayloadIntegrity(payload, expected) {
  assert(payload && typeof payload === "object", "Delivered payload is missing");
  assert.equal(payload.type, expected.format, "Delivered format changed");
  assert.equal(payload.encoding, "base64", "Delivered encoding changed");
  const bytes = Buffer.from(payload.data, "base64");
  assert.equal(bytes.length, expected.decodedBytes, "Delivered byte length changed");
  assert.equal(sha256(bytes), expected.sha256, "Delivered payload bytes changed");
  assert.equal(payload.protocol, expected.protocol, "Delivered byte protocol changed");
  assert.equal(payload.geometry_fingerprint, expected.geometryFingerprint, "Delivered geometry binding changed");
}
