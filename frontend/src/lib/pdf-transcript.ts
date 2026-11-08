/** PDF text is extracted in the browser; no document URL or external service is used. */
export const PDF_MAX_BYTES = 5 * 1024 * 1024;
export const PDF_MAX_PAGES = 100;
export const PDF_MAX_CHARACTERS = 200_000;
const PDF_TIMEOUT_MS = 30_000;

class PdfTranscriptError extends Error {}

export async function extractPdfTranscript(bytes: ArrayBuffer, signal?: AbortSignal): Promise<string> {
  if (!bytes.byteLength || bytes.byteLength > PDF_MAX_BYTES)
    throw new PdfTranscriptError("PDF должен быть непустым и не больше 5 МБ.");
  if (!new TextDecoder("latin1").decode(bytes.slice(0, 1024)).includes("%PDF-"))
    throw new PdfTranscriptError("Файл не похож на PDF. Выберите PDF с текстом разговора.");
  if (signal?.aborted) throw new PdfTranscriptError("Чтение PDF отменено.");

  const pdfjs = await import("pdfjs-dist");
  const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  // Text extraction needs no remote fonts, CMaps, WASM or document actions.
  class NoExternalBinaryData {
    async fetch() { throw new Error("External PDF resources are disabled"); }
  }
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    BinaryDataFactory: NoExternalBinaryData,
    useSystemFonts: false,
    disableFontFace: true,
    useWasm: false,
    isImageDecoderSupported: false,
    isOffscreenCanvasSupported: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    const stop = (message: string) => {
      reject(new PdfTranscriptError(message));
      void task.destroy();
    };
    timer = setTimeout(() => stop("Чтение PDF заняло слишком долго. Разделите документ или загрузите TXT."), PDF_TIMEOUT_MS);
    abort = () => stop("Чтение PDF отменено.");
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
  const read = async () => {
    const document = await task.promise;
    if (document.numPages > PDF_MAX_PAGES)
      throw new PdfTranscriptError("В PDF больше 100 страниц. Разделите документ на несколько файлов.");
    const pages: string[] = [];
    let length = 0;
    for (let number = 1; number <= document.numPages; number++) {
      if (signal?.aborted) throw new PdfTranscriptError("Чтение PDF отменено.");
      const page = await document.getPage(number);
      const reader = page.streamTextContent().getReader();
      let pageText = "";
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          for (const item of chunk.value.items) {
            if (!("str" in item)) continue;
            const part = `${item.str}${item.hasEOL ? "\n" : " "}`;
            length += part.length;
            if (length > PDF_MAX_CHARACTERS)
              throw new PdfTranscriptError("В PDF слишком много текста (более 200 000 символов). Разделите документ.");
            pageText += part;
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        page.cleanup();
      }
      if (!pageText.trim())
        throw new PdfTranscriptError(`На странице ${number} нет извлекаемого текста. Для сканов сначала выполните OCR и сохраните текстовый PDF или TXT.`);
      pages.push(pageText.trim());
    }
    const text = pages.join("\n");
    if (!text.trim()) throw new PdfTranscriptError("В PDF нет текста. Для скана сначала выполните OCR или загрузите TXT.");
    return text;
  };
  try {
    return await Promise.race([read(), stopped]);
  } catch (error) {
    if (error instanceof PdfTranscriptError) throw error;
    if (error instanceof Error && error.name === "PasswordException")
      throw new PdfTranscriptError("PDF защищён паролем. Снимите защиту локально и загрузите файл повторно.");
    throw new PdfTranscriptError("Не удалось прочитать PDF. Проверьте файл или экспортируйте разговор в TXT с подписями участников.");
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
    await task.destroy().catch(() => undefined);
  }
}
