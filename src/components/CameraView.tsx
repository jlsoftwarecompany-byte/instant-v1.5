import React, { useEffect, useRef, useState } from "react";
import { Camera, RotateCw, X, Check, RefreshCw, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { compressImage } from "../lib/compress";

interface CameraViewProps {
  onSend: (base64Data: string) => void;
  onClose: () => void;
}

export const CameraView: React.FC<CameraViewProps> = ({ onSend, onClose }) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [showFlash, setShowFlash] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);

  // Safely check if we are on a secure connection
  const isSecureConnection = () => {
    if (typeof window === "undefined") return true;
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    return protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";
  };

  const startCamera = async (currentFacing: "environment" | "user") => {
    // Check security constraints on iOS Webkit / Firefox / Chrome
    if (!isSecureConnection()) {
      setPermissionError("Camera requires a secure connection (HTTPS).");
      return;
    }

    try {
      // First stop any old track
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
      setPermissionError(null);

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: currentFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });

      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (e: any) {
      console.error("Camera access failed", e);
      setPermissionError("Camera access is required. Please allow camera permission in your browser settings.");
    }
  };

  useEffect(() => {
    startCamera(facingMode);

    return () => {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [facingMode]);

  // Clean stop whenever component unmounts
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  const toggleCamera = () => {
    const nextMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(nextMode);
  };

  const handleCapture = async () => {
    if (!videoRef.current || !stream) return;

    try {
      const video = videoRef.current;
      const canvas = document.createElement("canvas");
      // Draw image in original video frame coordinates to keep high quality!
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Handle flip mirror horizontal styling if user facing camera
      if (facingMode === "user") {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Trigger brief 80ms shutter flash overlay anim
      setShowFlash(true);
      setTimeout(() => setShowFlash(false), 80);

      // Convert drawing canvas to blob
      canvas.toBlob(async (blob) => {
        if (!blob) return;

        // Disconnect camera stream after capture
        if (stream) {
          stream.getTracks().forEach(t => t.stop());
          setStream(null);
        }

        setIsCompressing(true);
        try {
          // Send immediately to compression pipeline
          const compressedBase64 = await compressImage(blob);
          setCapturedPhoto(compressedBase64);
        } catch (error) {
          console.error("Compression failed", error);
        } finally {
          setIsCompressing(false);
        }
      }, "image/jpeg", 0.95);

    } catch (e) {
      console.error("Capture frame snapshot failed", e);
    }
  };

  const handleRetake = () => {
    setCapturedPhoto(null);
    startCamera(facingMode);
  };

  const handleSend = () => {
    if (capturedPhoto) {
      onSend(capturedPhoto);
    }
    // Automatically close overlay on completion
    onClose();
  };

  const handleStopAndClose = () => {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col justify-between overflow-hidden">
      
      {/* Absolute Shutter Flash Overlay */}
      <AnimatePresence>
        {showFlash && (
          <motion.div
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-white z-50 pointer-events-none"
            transition={{ duration: 0.08 }}
          />
        )}
      </AnimatePresence>

      {/* Top Header Panel */}
      <header className="absolute top-0 inset-x-0 p-5 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent z-40 select-none">
        <h3 className="text-white text-xs font-black uppercase tracking-widest flex items-center gap-1.5 leading-none">
          <Camera className="w-5 h-5 text-pink-500 animate-pulse" /> In-App Camera
        </h3>
        
        <button
          onClick={handleStopAndClose}
          className="p-2 border border-white/20 bg-black/40 text-white rounded-full hover:bg-white/10 active:scale-95 transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* Live Video View / Frozen Image Preview Panel */}
      <div className="flex-1 w-full bg-zinc-950 flex items-center justify-center relative overflow-hidden">
        
        {/* Permission and Connection Error banner display */}
        {permissionError ? (
          <div className="max-w-xs p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-500/15 text-red-500 flex items-center justify-center mx-auto border border-red-500/25">
              <X className="w-6 h-6" />
            </div>
            <p className="text-zinc-300 font-sans text-xs font-semibold leading-relaxed">
              {permissionError}
            </p>
            <button
              onClick={() => startCamera(facingMode)}
              className="px-4 py-2 bg-zinc-800 text-white text-xs font-bold rounded-xl hover:bg-zinc-700 transition cursor-pointer"
            >
              Try Re-enabling Camera
            </button>
          </div>
        ) : capturedPhoto ? (
          /* Captured photo preview display image */
          <div className="relative w-full h-full flex items-center justify-center p-4">
            <img
              src={capturedPhoto}
              alt="Photo preview"
              referrerPolicy="no-referrer"
              className="max-h-[80vh] max-w-full object-contain rounded-2xl border border-white/10 shadow-lg"
            />
          </div>
        ) : (
          /* Live Viewer element */
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${facingMode === "user" ? "scale-x-[-1]" : ""}`}
          />
        )}

        {/* Compression processing display loading overlay */}
        {isCompressing && (
          <div className="absolute inset-0 bg-black/85 backdrop-blur-xs flex flex-col items-center justify-center gap-3 z-30 select-none">
            <Loader2 className="w-10 h-10 text-pink-500 animate-spin" />
            <p className="text-pink-500 text-xs font-black uppercase tracking-widest animate-pulse">
              Compressing Visual Attachment...
            </p>
          </div>
        )}
      </div>

      {/* Camera Action Control Bottom Bar */}
      <footer className="w-full bg-zinc-950/95 border-t border-white/5 py-8 px-6 flex items-center justify-center z-40">
        
        {capturedPhoto ? (
          /* Action Panel: Send or Retake */
          <div className="flex items-center gap-5 w-full max-w-sm">
            <button
              onClick={handleRetake}
              className="flex-1 py-3.5 bg-zinc-900 border border-white/10 hover:bg-zinc-800 text-white text-xs font-black uppercase tracking-wider rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
            >
              <RefreshCw className="w-4 h-4" /> Retake Photo
            </button>
            
            <button
              onClick={handleSend}
              className="flex-1 py-3.5 bg-gradient-to-r from-[#FE2C55] to-[#a855f7] text-white text-xs font-black uppercase tracking-wider rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-lg active:scale-95"
            >
              <Check className="w-4 h-4" /> Send Camera Photo
            </button>
          </div>
        ) : (
          /* Action Panel: Capture Controls */
          <div className="flex items-center justify-between w-full max-w-sm">
            
            {/* Left Placeholder for visual balance */}
            <div className="w-12 h-12" />

            {/* Central circle capture release */}
            <button
              onClick={handleCapture}
              disabled={!!permissionError}
              className="w-20 h-20 bg-white border-[6px] border-zinc-800 rounded-full flex items-center justify-center hover:bg-zinc-200 active:scale-90 transition transform duration-150 disabled:opacity-40 select-none cursor-pointer"
              aria-label="Capture button"
            >
              <div className="w-12 h-12 bg-white rounded-full border border-black/10 shadow-inner" />
            </button>

            {/* Right flip camera toggle button */}
            <button
              onClick={toggleCamera}
              disabled={!!permissionError}
              className="w-12 h-12 rounded-full bg-zinc-900 border border-white/10 text-white flex items-center justify-center hover:bg-zinc-800 active:scale-90 transition cursor-pointer"
              title="Flip Camera orientation"
            >
              <RotateCw className="w-5 h-5" />
            </button>
          </div>
        )}
      </footer>
    </div>
  );
};
