/**
 * In-browser Image Compression Pipeline
 * Guarantees output size <= 800KB using sequential quality and size reductions.
 */
export async function compressImage(fileOrBlob: File | Blob): Promise<string> {
  // Load image safely using ObjectURL
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(fileOrBlob);
    
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    
    image.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image element"));
    };
    
    image.src = url;
  });

  // Check for WebP format support
  let format = "image/webp";
  try {
    const testCanvas = document.createElement("canvas");
    testCanvas.width = 1;
    testCanvas.height = 1;
    if (!testCanvas.toDataURL("image/webp").startsWith("data:image/webp")) {
      format = "image/jpeg";
    }
  } catch (e) {
    format = "image/jpeg";
  }

  // Set initial dimensions adhering to max 1280x1280 bounding box
  let width = img.width;
  let height = img.height;
  const maxDim = 1280;
  if (width > maxDim || height > maxDim) {
    if (width > height) {
      height = Math.round((height * maxDim) / width);
      width = maxDim;
    } else {
      width = Math.round((width * maxDim) / height);
      height = maxDim;
    }
  }

  const canvas = document.createElement("canvas");
  let quality = 0.82;
  let qualityRetries = 0;
  const minQuality = 0.35;

  while (true) {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not get 2D canvas context");
    }
    
    // Canvas draw step
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    // Export base64 dataURI at current quality
    const dataUrl = canvas.toDataURL(format, quality);
    
    // Estimate size in bytes: Base64 content length * 3/4
    const base64Data = dataUrl.split(",")[1];
    const sizeInBytes = base64Data ? base64Data.length * 0.75 : 0;

    // Guaranteed <= 800KB constraint
    if (sizeInBytes <= 800 * 1024) {
      return dataUrl;
    }

    // Try reducing quality first (up to 5 times)
    if (qualityRetries < 5 && quality > minQuality) {
      quality = Math.max(minQuality, quality - 0.10);
      qualityRetries++;
    } else {
      // Reduce dimensions by 50% and reset quality
      width = Math.round(width * 0.5);
      height = Math.round(height * 0.5);
      quality = 0.82;
      qualityRetries = 0;

      // Stop loop if dimensions collapse to miniature size
      if (width < 4 || height < 4) {
        return dataUrl;
      }
    }
  }
}
