export type ResizedImage = {
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
};

const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
const BLOCKED_MIME_TYPES = new Set(['image/svg+xml']);

export function assertSafeImageFile(file: File): void {
  if (!file.type.startsWith('image/')) {
    throw new Error('Upload an image file.');
  }

  if (BLOCKED_MIME_TYPES.has(file.type)) {
    throw new Error('SVG uploads are not supported.');
  }

  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error('Images must be 5 MB or smaller.');
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read file.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load image.'));
    image.src = dataUrl;
  });
}

export async function resizeImageToDataUrl(
  file: File,
  maxDimension = 512
): Promise<ResizedImage> {
  assertSafeImageFile(file);
  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(originalDataUrl);
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Unable to process image.');
  }

  context.drawImage(image, 0, 0, width, height);

  const requestedType = file.type === 'image/png' ? 'image/png' : 'image/webp';
  let dataUrl = canvas.toDataURL(requestedType, 0.88);
  let mimeType = requestedType;

  if (dataUrl === 'data:,') {
    dataUrl = canvas.toDataURL('image/png');
    mimeType = 'image/png';
  }

  return { dataUrl, mimeType, width, height };
}
