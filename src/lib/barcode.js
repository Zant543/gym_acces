/**
 * barcode.js — Lector de Códigos de Barras y Códigos QR
 *
 * Prioriza la API nativa del navegador (BarcodeDetector) por máxima velocidad (0ms-5ms)
 * y aceleración por hardware en Chrome/Edge/Android.
 * Incluye fallback dinámico con @zxing/library vía CDN para navegadores sin BarcodeDetector.
 */

let zxingReaderInstance = null
let nativeDetectorInstance = null
let checkedNativeSupport = false
let isNativeSupported = false

const DESIRED_FORMATS = [
  'code_128',
  'code_39',
  'code_93',
  'codabar',
  'ean_13',
  'ean_8',
  'itf',
  'upc_a',
  'upc_e',
  'qr_code',
  'data_matrix',
  'pdf417',
  'aztec'
]

/**
 * Verifica si BarcodeDetector nativo está soportado en este navegador/dispositivo.
 */
export async function getBarcodeCapabilities() {
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats()
      return {
        hasNative: true,
        formats: supported
      }
    } catch {
      return { hasNative: false, formats: [] }
    }
  }
  return { hasNative: false, formats: [] }
}

/**
 * Escanea un canvas, imagen o video en busca de código de barras o QR.
 *
 * @param {HTMLCanvasElement|HTMLVideoElement|HTMLImageElement} source
 * @returns {Promise<{code: string, format: string, engine: string}|null>}
 */
export async function scanBarcode(source) {
  if (!source) return null

  // ── 1. Intentar BarcodeDetector nativo (Ultrarrápido y robusto) ────
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      if (!nativeDetectorInstance) {
        let formatsToUse = DESIRED_FORMATS
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats()
          formatsToUse = DESIRED_FORMATS.filter(f => supported.includes(f))
        } catch { /* Ignorar error de getSupportedFormats */ }

        nativeDetectorInstance = new window.BarcodeDetector({ formats: formatsToUse })
      }

      const results = await nativeDetectorInstance.detect(source)
      if (results && results.length > 0) {
        const primary = results[0]
        const raw = (primary.rawValue || '').trim()
        if (raw) {
          return {
            code: raw,
            format: primary.format || 'barcode',
            engine: 'BarcodeDetector (Nativo)'
          }
        }
      }
    } catch (err) {
      console.warn('[Barcode] BarcodeDetector nativo falló en el fotograma:', err?.message)
    }
  }

  // ── 2. Fallback dinámico con @zxing/library ───────────────────────
  try {
    if (!zxingReaderInstance) {
      const zxing = await import(/* @vite-ignore */ 'https://esm.sh/@zxing/library@0.21.3')
      const MultiFormatReader = zxing.BrowserMultiFormatReader || zxing.default?.BrowserMultiFormatReader
      if (MultiFormatReader) {
        zxingReaderInstance = new MultiFormatReader()
      }
    }

    if (zxingReaderInstance) {
      let result = null
      if (source instanceof HTMLCanvasElement) {
        result = zxingReaderInstance.decodeFromCanvas(source)
      } else if (source instanceof HTMLVideoElement) {
        result = await zxingReaderInstance.decodeOnce(source)
      }
      if (result) {
        const raw = result.getText()?.trim() || ''
        if (raw) {
          return {
            code: raw,
            format: result.getBarcodeFormat()?.toString() || 'barcode',
            engine: 'ZXing (Fallback)'
          }
        }
      }
    }
  } catch (err) {
    // Si no se encuentra código de barras en este frame, falla silenciosamente
  }

  return null
}

/**
 * Intenta extraer un ID o clave de socio válida del contenido decodificado del código de barras o QR.
 * Soporta códigos directos (ej. "SOC-001", "21120001", "S0012") o URLs/cadenas con el ID embebido.
 *
 * @param {string} rawCode
 * @returns {string|null}
 */
export function extractMatriculaFromBarcode(rawCode) {
  if (!rawCode) return null
  const clean = rawCode.trim()

  // 1. Si el código ya ES el identificador directo (numérico de 4 a 10 dígitos)
  if (/^\d{4,10}$/.test(clean)) {
    return clean
  }

  // 2. Clave de socio con formato con guión (ej. SOC-001, GYM-1234)
  if (/^[A-Z]{2,4}-\d{1,8}$/i.test(clean)) {
    return clean.toUpperCase()
  }

  // 3. Clave con letra inicial y dígitos (ej. S21120001, C21120001, L21120001)
  if (/^[A-Z]\d{4,9}$/i.test(clean)) {
    return clean.toUpperCase()
  }

  // 4. Buscar patrón con prefijo embebido (ej. "Socio: XXXXXXXX", "ID: XXXXXXXX", "Clave: XXXXXXXX", "Control: XXXXXXXX")
  const prefixMatch = clean.match(/(?:socio|clave|id|control)[\s:.\-]*([A-Z0-9\-]{3,12})/i)
  if (prefixMatch) {
    return prefixMatch[1].toUpperCase()
  }

  // 5. Coincidencia general embebida en la cadena
  const ID_REGEX = /\b([A-Z]?\d{6,10})\b/i
  const match = clean.match(ID_REGEX)
  if (match) {
    return match[1].toUpperCase()
  }

  // 6. Si el código es alfanumérico estándar de longitud 4-12 (sin espacios)
  if (/^[A-Z0-9]{4,12}$/i.test(clean)) {
    return clean.toUpperCase()
  }

  return null
}
