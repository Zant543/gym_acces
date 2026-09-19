/**
 * ocr.js — Wrapper de Tesseract.js para extracción de matrícula
 *
 * Ejecuta el reconocimiento en un Worker separado para no bloquear la UI.
 * Estrategia: captura un frame del <video>, lo pasa al worker OCR,
 * luego aplica un regex para extraer la matrícula.
 */
// Regex para validar matrícula (ajustable por entorno)
const MATRICULA_REGEX = new RegExp(
  import.meta.env.VITE_MATRICULA_REGEX || '^[A-Z][0-9]{8}$'
)

let workerInstance = null
let workerReady    = false

/**
 * Inicializa el worker de Tesseract mediante importación dinámica.
 */
export async function initOCRWorker(onProgress) {
  if (workerInstance) return workerInstance

  try {
    const tesseractModule = await import('tesseract.js')
    const createWorker = tesseractModule.createWorker || tesseractModule.default?.createWorker

    workerInstance = await createWorker('spa', 1, {
      logger: (m) => {
        if (onProgress && m.status === 'recognizing text') {
          onProgress(Math.round(m.progress * 100))
        }
      },
      errorHandler: (err) => console.error('[OCR Worker]', err)
    })

    // Configurar para texto de documentos de identidad incluyendo minúsculas y puntuación
    await workerInstance.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:.- /',
      tessedit_pageseg_mode:   '6', // Assume uniform block of text
    })

    workerReady = true
    console.log('[OCR] Worker listo')
    return workerInstance
  } catch (err) {
    console.error('[OCR] Error inicializando tesseract.js dinámicamente:', err)
    throw err
  }
}

/**
 * Reconoce texto de una imagen o canvas usando importación dinámica de tesseract.js.
 */
export async function recognizeText(source, onProgress) {
  try {
    const { createWorker } = await import('tesseract.js')
    const worker = workerInstance || await initOCRWorker(onProgress)
    const { data } = await worker.recognize(source)
    return data
  } catch (err) {
    console.error('[OCR recognizeText error]:', err)
    throw err
  }
}

/**
 * Captura un frame del elemento <video> y devuelve el canvas resultante.
 *
 * @param {HTMLVideoElement} videoEl
 * @returns {HTMLCanvasElement}
 */
export function captureFrame(videoEl) {
  const canvas = document.createElement('canvas')
  canvas.width  = videoEl.videoWidth  || 640
  canvas.height = videoEl.videoHeight || 480
  const ctx = canvas.getContext('2d')
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
  return canvas
}

/**
 * Dimensiones calculadas del recuadro de enfoque (ROI)
 * donde el socio alinea la franja de identificación de la credencial.
 */
export function getTargetDimensions(w, h) {
  // Marco / barra de escaneo amplia para credenciales completas
  const targetW = Math.min(w * 0.94, 680)
  const targetH = Math.max(160, Math.min(targetW * 0.52, 280))
  const targetX = (w - targetW) / 2
  const targetY = (h - targetH) / 2 - 20 // Ligeramente arriba del centro
  return { targetX, targetY, targetW, targetH }
}

/**
 * Captura exclusivamente el área delimitada por la guía de la matrícula (ROI)
 * y aplica Binarización de Imagen (escala de grises + threshold adaptativo)
 * para eliminar sombras y destellos/reflejos del plástico de la credencial.
 *
 * @param {HTMLVideoElement} videoEl
 * @returns {HTMLCanvasElement}
 */
export function captureCredentialROI(videoEl) {
  const vw = videoEl.videoWidth  || 640
  const vh = videoEl.videoHeight || 480
  const cw = videoEl.clientWidth  || vw
  const ch = videoEl.clientHeight || vh

  // Dimensiones del recuadro visual tal como lo ve el usuario en pantalla
  const { targetX: screenX, targetY: screenY, targetW: screenW, targetH: screenH } = getTargetDimensions(cw, ch)

  // Mapeo preciso de coordenadas de pantalla (CSS object-cover) a píxeles del stream de video
  const scale = Math.max(cw / vw, ch / vh)
  const renderedW = vw * scale
  const renderedH = vh * scale
  const offsetX = (cw - renderedW) / 2
  const offsetY = (ch - renderedH) / 2

  let vidX = Math.round((screenX - offsetX) / scale)
  let vidY = Math.round((screenY - offsetY) / scale)
  let vidW = Math.round(screenW / scale)
  let vidH = Math.round(screenH / scale)

  // Clamping a los límites reales del frame del sensor
  vidX = Math.max(0, Math.min(vidX, vw - 10))
  vidY = Math.max(0, Math.min(vidY, vh - 10))
  vidW = Math.max(20, Math.min(vidW, vw - vidX))
  vidH = Math.max(20, Math.min(vidH, vh - vidY))

  // Escalar la región capturada a 2.0x para mayor resolución tipográfica en OCR
  const scaleTarget = 2.0
  const canvas = document.createElement('canvas')
  canvas.width  = Math.max(100, Math.round(vidW * scaleTarget))
  canvas.height = Math.max(40, Math.round(vidH * scaleTarget))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  // 1. Dibujar exclusivamente la subregión recortada de la credencial
  ctx.drawImage(
    videoEl,
    vidX, vidY, vidW, vidH,
    0, 0, canvas.width, canvas.height
  )

  // 2. Preprocesamiento mejorado para credenciales con fondo claro + texto oscuro
  try {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imgData.data
    const totalPixels = canvas.width * canvas.height

    // Primer pase: convertir a escala de grises con coeficientes luminancia estándar
    let sumBrightness = 0
    const grays = new Uint8Array(totalPixels)
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
      grays[j] = gray
      sumBrightness += gray
    }

    const meanBrightness = sumBrightness / totalPixels

    // Umbral adaptativo mejorado:
    // - Fondo claro (mean > 140): usar threshold más alto para capturar texto azul/negro en blanco
    // - Fondo oscuro (mean ≤ 140): usar threshold más bajo conservador
    let threshold
    if (meanBrightness > 140) {
      // Credencial de fondo blanco: texto oscuro vs fondo claro
      threshold = Math.max(80, Math.min(200, Math.round(meanBrightness * 0.75)))
    } else {
      // Fondo oscuro o mixto
      threshold = Math.max(60, Math.min(170, Math.round(meanBrightness * 0.90)))
    }

    // Segundo pase: Binarización (0 negro, 255 blanco)
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const val = grays[j] < threshold ? 0 : 255
      data[i]     = val
      data[i + 1] = val
      data[i + 2] = val
    }

    ctx.putImageData(imgData, 0, 0)
  } catch (err) {
    console.warn('[OCR] Preprocesamiento de binarización falló:', err)
  }

  return canvas
}

/**
 * Captura un snapshot estático de la credencial produciendo tanto la versión a color
 * como la versión binarizada, generando data URLs para el debugger visual.
 *
 * @param {HTMLVideoElement} videoEl
 * @returns {{colorCanvas: HTMLCanvasElement, binarizedCanvas: HTMLCanvasElement, colorDataUrl: string, binarizedDataUrl: string, width: number, height: number, timestamp: number}}
 */
export function captureCredentialSnapshot(videoEl) {
  const vw = videoEl.videoWidth  || 640
  const vh = videoEl.videoHeight || 480
  const cw = videoEl.clientWidth  || vw
  const ch = videoEl.clientHeight || vh

  const { targetX: screenX, targetY: screenY, targetW: screenW, targetH: screenH } = getTargetDimensions(cw, ch)

  const scale = Math.max(cw / vw, ch / vh)
  const renderedW = vw * scale
  const renderedH = vh * scale
  const offsetX = (cw - renderedW) / 2
  const offsetY = (ch - renderedH) / 2

  let vidX = Math.round((screenX - offsetX) / scale)
  let vidY = Math.round((screenY - offsetY) / scale)
  let vidW = Math.round(screenW / scale)
  let vidH = Math.round(screenH / scale)

  vidX = Math.max(0, Math.min(vidX, vw - 10))
  vidY = Math.max(0, Math.min(vidY, vh - 10))
  vidW = Math.max(20, Math.min(vidW, vw - vidX))
  vidH = Math.max(20, Math.min(vidH, vh - vidY))

  const scaleTarget = 2.0
  const width = Math.max(120, Math.round(vidW * scaleTarget))
  const height = Math.max(45, Math.round(vidH * scaleTarget))

  // 1. Canvas en Color
  const colorCanvas = document.createElement('canvas')
  colorCanvas.width = width
  colorCanvas.height = height
  const colorCtx = colorCanvas.getContext('2d', { willReadFrequently: true })
  colorCtx.drawImage(videoEl, vidX, vidY, vidW, vidH, 0, 0, width, height)

  // 2. Canvas Binarizado para OCR
  const binarizedCanvas = document.createElement('canvas')
  binarizedCanvas.width = width
  binarizedCanvas.height = height
  const binarizedCtx = binarizedCanvas.getContext('2d', { willReadFrequently: true })
  binarizedCtx.drawImage(videoEl, vidX, vidY, vidW, vidH, 0, 0, width, height)

  try {
    const imgData = binarizedCtx.getImageData(0, 0, width, height)
    const data = imgData.data
    const totalPixels = width * height

    let sumBrightness = 0
    const grays = new Uint8Array(totalPixels)
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
      grays[j] = gray
      sumBrightness += gray
    }

    const meanBrightness = sumBrightness / totalPixels
    // Umbral adaptativo: fondo claro (credencial TecNM) vs fondo oscuro
    const threshold = meanBrightness > 140
      ? Math.max(80, Math.min(200, Math.round(meanBrightness * 0.75)))
      : Math.max(60, Math.min(170, Math.round(meanBrightness * 0.90)))

    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const val = grays[j] < threshold ? 0 : 255
      data[i]     = val
      data[i + 1] = val
      data[i + 2] = val
    }

    binarizedCtx.putImageData(imgData, 0, 0)
  } catch (err) {
    console.warn('[OCR] Preprocesamiento de binarización falló:', err)
  }

  let colorDataUrl = ''
  let binarizedDataUrl = ''
  try {
    colorDataUrl = colorCanvas.toDataURL('image/jpeg', 0.9)
    binarizedDataUrl = binarizedCanvas.toDataURL('image/png')
  } catch (e) { /* ignore */ }

  return {
    colorCanvas,
    binarizedCanvas,
    colorDataUrl,
    binarizedDataUrl,
    width,
    height,
    timestamp: Date.now()
  }
}

/**
 * Captura un frame y lo devuelve como Data URL (JPEG, para guardar foto).
 *
 * @param {HTMLVideoElement} videoEl
 * @param {number} quality - 0 a 1 (defecto 0.85)
 * @returns {string} data URL JPEG
 */
export function capturePhotoDataUrl(videoEl, quality = 0.85) {
  const canvas = captureFrame(videoEl)
  return canvas.toDataURL('image/jpeg', quality)
}

/**
 * Extrae texto de un canvas/imagen y busca una matrícula mediante expresión regular.
 * Devuelve tanto la matrícula procesada como el texto raw y métricas para el depurador.
 *
 * @param {HTMLCanvasElement|HTMLVideoElement|string} source - canvas, video o data URL
 * @returns {Promise<{matricula:string|null, rawText:string, confidence:number, timeTaken:number}>}
 */
export async function extractMatricula(source) {
  if (!workerInstance || !workerReady) {
    throw new Error('OCR Worker no inicializado. Llama initOCRWorker() primero.')
  }

  const startTime = performance.now()
  let imageSource = source

  // Si es un elemento <video>, capturar snapshot binarizado
  if (source instanceof HTMLVideoElement) {
    const snapshot = captureCredentialSnapshot(source)
    imageSource = snapshot.binarizedCanvas
  }

  const { data } = await workerInstance.recognize(imageSource)
  const rawText  = (data?.text || '').trim()

  let matricula = null

  // ── 1. Patrón con prefijo: "Socio: XXXXX", "ID: XXXXX", "Clave: XXXXX", "Control: XXXXX" ──
  const controlMatch = rawText.match(/(?:socio|clave|id|control|no\.?\s*socio|no\.?\s*control)[\s:.\-_]*([A-Za-z0-9]{5,10})/i)
  if (controlMatch) {
    const candidate = controlMatch[1]
    const cleaned = candidate.replace(/[oO]/g, '0').replace(/[iIl|]/g, '1')
    const digitsOnly = cleaned.replace(/\D/g, '')
    if (digitsOnly.length >= 5 && digitsOnly.length <= 9) {
      matricula = digitsOnly
    } else if (/^[A-Za-z]\d{5,9}$/.test(cleaned)) {
      matricula = cleaned.toUpperCase()
    }
  }

  // ── 2. Regex general: 6 a 9 dígitos puros (ej. 25460720) ──────────
  if (!matricula) {
    const digitsMatch = rawText.match(/\b(\d{6,9})\b/)
    if (digitsMatch) {
      matricula = digitsMatch[1]
    }
  }

  // ── 3. Regex alfanumérico estándar: letra + 6-9 dígitos (ej. S21120001) ──
  if (!matricula) {
    const letterMatch = rawText.match(/\b([A-Z]\d{6,9})\b/i)
    if (letterMatch) {
      matricula = letterMatch[1].toUpperCase()
    }
  }

  // ── 4. Búsqueda alternativa token a token ─────────────────────
  if (!matricula) {
    const tokens = rawText.split(/[\s\n\r]+/)
    for (const token of tokens) {
      const clean = token.replace(/[^A-Za-z0-9]/g, '')
      if (/^\d{7,9}$/.test(clean)) {
        matricula = clean
        break
      }
      if (/^[A-Z]\d{7,9}$/i.test(clean)) {
        matricula = clean.toUpperCase()
        break
      }
      // Limpiar posibles errores OCR (O -> 0, I -> 1)
      const cleanedNum = clean.replace(/[oO]/g, '0').replace(/[iIl|]/g, '1')
      if (/^\d{7,9}$/.test(cleanedNum)) {
        matricula = cleanedNum
        break
      }
    }
  }

  const timeTaken = Math.round(performance.now() - startTime)

  return {
    matricula,
    rawText,
    confidence: data?.confidence || 0,
    timeTaken
  }
}

/**
 * Termina el worker de Tesseract (llamar al desmontar el componente).
 */
export async function terminateOCRWorker() {
  if (workerInstance) {
    await workerInstance.terminate()
    workerInstance = null
    workerReady    = false
    console.log('[OCR] Worker terminado')
  }
}

/**
 * Dibuja el overlay de guía visual en un canvas superpuesto al video.
 * Enmarca específicamente la zona de la matrícula con la indicación guiada.
 *
 * @param {HTMLCanvasElement} overlayCanvas
 * @param {boolean} isScanning - true = animación de escaneo activa
 */
export function drawOverlay(overlayCanvas, isScanning = false) {
  const ctx = overlayCanvas.getContext('2d')
  const w   = overlayCanvas.width
  const h   = overlayCanvas.height

  ctx.clearRect(0, 0, w, h)

  const { targetX, targetY, targetW, targetH } = getTargetDimensions(w, h)

  // 1. Overlay oscuro translúcido alrededor del recuadro guiado
  ctx.fillStyle = 'rgba(0,0,0,0.60)'
  ctx.fillRect(0, 0, w, targetY)
  ctx.fillRect(0, targetY + targetH, w, h - targetY - targetH)
  ctx.fillRect(0, targetY, targetX, targetH)
  ctx.fillRect(targetX + targetW, targetY, w - targetX - targetW, targetH)

  // 2. Marco interior con esquinas reforzadas
  const cornerLen = Math.min(28, Math.round(targetW * 0.1))
  const lineColor = isScanning ? '#eab308' : '#38bdf8'
  ctx.strokeStyle = lineColor
  ctx.lineWidth   = 3.5
  ctx.lineCap     = 'round'

  const corners = [
    [targetX,            targetY,            cornerLen, 0,         0,         cornerLen],
    [targetX + targetW,  targetY,           -cornerLen, 0,         0,         cornerLen],
    [targetX,            targetY + targetH,  cornerLen, 0,         0,        -cornerLen],
    [targetX + targetW,  targetY + targetH, -cornerLen, 0,         0,        -cornerLen],
  ]
  corners.forEach(([x, y, dx1, dy1, dx2, dy2]) => {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx1, y + dy1); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx2, y + dy2); ctx.stroke()
  })

  // 3. Línea de escaneo animada
  if (isScanning) {
    const scanY = targetY + ((Date.now() % 1600) / 1600) * targetH
    const gradient = ctx.createLinearGradient(targetX, scanY - 6, targetX, scanY + 6)
    gradient.addColorStop(0,   'rgba(234, 179, 8, 0)')
    gradient.addColorStop(0.5, 'rgba(234, 179, 8, 0.85)')
    gradient.addColorStop(1,   'rgba(234, 179, 8, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(targetX, scanY - 6, targetW, 12)
  }

  // 4. Etiqueta guiada: "Alinea aquí la credencial de socio"
  const labelText = isScanning ? 'Escaneando credencial...' : 'Alinea aquí la credencial de socio'
  const fontSize = w < 600 ? 12 : 14
  ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`
  ctx.textAlign = 'center'

  const textWidth = ctx.measureText(labelText).width
  const pillPadding = 14
  const pillH = fontSize + 12
  const pillY = targetY - pillH - 12
  const pillX = (w - textWidth - pillPadding * 2) / 2

  ctx.fillStyle = 'rgba(0, 0, 0, 0.78)'
  if (ctx.roundRect) {
    ctx.beginPath()
    ctx.roundRect(pillX, pillY, textWidth + pillPadding * 2, pillH, 8)
    ctx.fill()
    ctx.strokeStyle = isScanning ? 'rgba(234, 179, 8, 0.6)' : 'rgba(56, 189, 248, 0.4)'
    ctx.lineWidth = 1
    ctx.stroke()
  } else {
    ctx.fillRect(pillX, pillY, textWidth + pillPadding * 2, pillH)
  }

  ctx.fillStyle = isScanning ? '#fef08a' : '#ffffff'
  ctx.fillText(labelText, w / 2, pillY + fontSize + 2)
}
