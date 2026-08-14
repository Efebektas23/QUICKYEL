"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  RotateCcw,
  ExternalLink,
  X,
  Search,
  Move,
} from "lucide-react";

interface ReceiptImageViewerProps {
  src: string;
  alt?: string;
  className?: string;
  aspectRatio?: string;
  magnifierSize?: number;
  zoomLevel?: number;
  showControls?: boolean;
  showExternalLink?: boolean;
  compact?: boolean;
}

export function ReceiptImageViewer({
  src,
  alt = "Receipt",
  className = "",
  aspectRatio = "3/4",
  magnifierSize = 180,
  zoomLevel = 2.5,
  showControls = true,
  showExternalLink = true,
  compact = false,
}: ReceiptImageViewerProps) {
  // --- Hover magnifier state ---
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [showMagnifier, setShowMagnifier] = useState(false);
  const [magnifierPos, setMagnifierPos] = useState({ x: 0, y: 0 });
  const [imgNaturalSize, setImgNaturalSize] = useState({ w: 0, h: 0 });

  // --- Toolbar zoom state ---
  const [toolbarZoom, setToolbarZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  // --- Lightbox state ---
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lbZoom, setLbZoom] = useState(1);
  const [lbPan, setLbPan] = useState({ x: 0, y: 0 });
  const [lbPanning, setLbPanning] = useState(false);
  const lbPanStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  // Load natural image dimensions for magnifier calculations
  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    },
    []
  );

  // --- Hover magnifier handlers ---
  const handleMouseEnter = useCallback(() => {
    if (toolbarZoom > 1) return; // Don't show magnifier when already zoomed
    setShowMagnifier(true);
  }, [toolbarZoom]);

  const handleMouseLeave = useCallback(() => {
    setShowMagnifier(false);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current || toolbarZoom > 1) return;

      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      setMagnifierPos({ x, y });
    },
    [toolbarZoom]
  );

  // --- Toolbar zoom handlers ---
  const zoomIn = useCallback(() => {
    setToolbarZoom((z) => Math.min(z + 0.5, 5));
    setShowMagnifier(false);
  }, []);

  const zoomOut = useCallback(() => {
    setToolbarZoom((z) => {
      const newZ = Math.max(z - 0.5, 1);
      if (newZ === 1) setPanOffset({ x: 0, y: 0 });
      return newZ;
    });
  }, []);

  const resetZoom = useCallback(() => {
    setToolbarZoom(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  // --- Pan handlers (for toolbar zoom) ---
  const handlePanStart = useCallback(
    (e: React.MouseEvent) => {
      if (toolbarZoom <= 1) return;
      e.preventDefault();
      setIsPanning(true);
      panStart.current = {
        x: e.clientX,
        y: e.clientY,
        ox: panOffset.x,
        oy: panOffset.y,
      };
    },
    [toolbarZoom, panOffset]
  );

  const handlePanMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setPanOffset({
        x: panStart.current.ox + dx,
        y: panStart.current.oy + dy,
      });
    },
    [isPanning]
  );

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  // --- Scroll wheel zoom on main image ---
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.25 : 0.25;
      setToolbarZoom((z) => {
        const newZ = Math.min(Math.max(z + delta, 1), 5);
        if (newZ === 1) setPanOffset({ x: 0, y: 0 });
        if (newZ > 1) setShowMagnifier(false);
        return newZ;
      });
    },
    []
  );

  // --- Lightbox handlers ---
  const openLightbox = useCallback(() => {
    setLightboxOpen(true);
    setLbZoom(1);
    setLbPan({ x: 0, y: 0 });
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
  }, []);

  const lbZoomIn = useCallback(() => {
    setLbZoom((z) => Math.min(z + 0.5, 8));
  }, []);

  const lbZoomOut = useCallback(() => {
    setLbZoom((z) => {
      const newZ = Math.max(z - 0.5, 0.5);
      if (newZ <= 1) setLbPan({ x: 0, y: 0 });
      return newZ;
    });
  }, []);

  const lbReset = useCallback(() => {
    setLbZoom(1);
    setLbPan({ x: 0, y: 0 });
  }, []);

  const handleLbWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    setLbZoom((z) => {
      const newZ = Math.min(Math.max(z + delta, 0.5), 8);
      if (newZ <= 1) setLbPan({ x: 0, y: 0 });
      return newZ;
    });
  }, []);

  const handleLbPanStart = useCallback(
    (e: React.MouseEvent) => {
      if (lbZoom <= 1) return;
      e.preventDefault();
      setLbPanning(true);
      lbPanStart.current = {
        x: e.clientX,
        y: e.clientY,
        ox: lbPan.x,
        oy: lbPan.y,
      };
    },
    [lbZoom, lbPan]
  );

  const handleLbPanMove = useCallback(
    (e: React.MouseEvent) => {
      if (!lbPanning) return;
      const dx = e.clientX - lbPanStart.current.x;
      const dy = e.clientY - lbPanStart.current.y;
      setLbPan({
        x: lbPanStart.current.ox + dx,
        y: lbPanStart.current.oy + dy,
      });
    },
    [lbPanning]
  );

  const handleLbPanEnd = useCallback(() => {
    setLbPanning(false);
  }, []);

  // --- Keyboard shortcuts for lightbox ---
  useEffect(() => {
    if (!lightboxOpen) return;

    const handleKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          closeLightbox();
          break;
        case "+":
        case "=":
          lbZoomIn();
          break;
        case "-":
        case "_":
          lbZoomOut();
          break;
        case "0":
          lbReset();
          break;
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [lightboxOpen, closeLightbox, lbZoomIn, lbZoomOut, lbReset]);

  // Prevent body scroll when lightbox is open
  useEffect(() => {
    if (lightboxOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [lightboxOpen]);

  // Computed magnifier lens radius
  const lensRadius = magnifierSize / 2;
  const effectiveMagSize = compact ? Math.min(magnifierSize, 140) : magnifierSize;
  const effectiveLensRadius = effectiveMagSize / 2;

  return (
    <>
      {/* Main viewer container */}
      <div
        className={`relative group rounded-xl overflow-hidden bg-slate-800 ${className}`}
        style={{ aspectRatio }}
      >
        {/* Image container with zoom/pan */}
        <div
          ref={containerRef}
          className="relative w-full h-full overflow-hidden"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onMouseMove={handleMouseMove}
          onMouseDown={handlePanStart}
          onMouseUp={handlePanEnd}
          onWheel={handleWheel}
          style={{
            cursor:
              toolbarZoom > 1
                ? isPanning
                  ? "grabbing"
                  : "grab"
                : "crosshair",
          }}
          /* eslint-disable-next-line react/no-unknown-property */
          onMouseMoveCapture={handlePanMove}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={src}
            alt={alt}
            className="w-full h-full object-contain transition-transform duration-200 ease-out select-none"
            style={{
              transform: `scale(${toolbarZoom}) translate(${panOffset.x / toolbarZoom}px, ${panOffset.y / toolbarZoom}px)`,
              transformOrigin: "center center",
            }}
            onLoad={handleImageLoad}
            draggable={false}
          />

          {/* Magnifier lens overlay (appears on hover) */}
          {showMagnifier && imgNaturalSize.w > 0 && (
            <div
              className="absolute pointer-events-none z-20 border-2 border-amber-400/60 shadow-lg shadow-amber-500/20"
              style={{
                width: effectiveMagSize,
                height: effectiveMagSize,
                borderRadius: "50%",
                left: magnifierPos.x - effectiveLensRadius,
                top: magnifierPos.y - effectiveLensRadius,
                backgroundImage: `url(${src})`,
                backgroundRepeat: "no-repeat",
                backgroundSize: `${
                  (containerRef.current?.offsetWidth || 1) * zoomLevel
                }px ${
                  (containerRef.current?.offsetHeight || 1) * zoomLevel
                }px`,
                backgroundPositionX: -(
                  magnifierPos.x * zoomLevel -
                  effectiveLensRadius
                ),
                backgroundPositionY: -(
                  magnifierPos.y * zoomLevel -
                  effectiveLensRadius
                ),
                backdropFilter: "blur(1px)",
              }}
            />
          )}

          {/* Hover hint */}
          {toolbarZoom === 1 && !showMagnifier && (
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/80 backdrop-blur-sm border border-slate-700/50">
                <Search className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs text-slate-300">
                  Hover to magnify
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Zoom controls toolbar */}
        {showControls && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 rounded-xl bg-slate-900/90 backdrop-blur-md border border-slate-700/50 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
            <button
              onClick={(e) => {
                e.stopPropagation();
                zoomOut();
              }}
              disabled={toolbarZoom <= 1}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>

            <span className="text-xs font-mono text-slate-300 min-w-[3rem] text-center select-none">
              {Math.round(toolbarZoom * 100)}%
            </span>

            <button
              onClick={(e) => {
                e.stopPropagation();
                zoomIn();
              }}
              disabled={toolbarZoom >= 5}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            {toolbarZoom > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  resetZoom();
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
                title="Reset zoom"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}

            <div className="w-px h-5 bg-slate-700 mx-0.5" />

            <button
              onClick={(e) => {
                e.stopPropagation();
                openLightbox();
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
              title="Fullscreen view"
            >
              <Maximize2 className="w-4 h-4" />
            </button>

            {showExternalLink && (
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
                title="Open in new tab"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        )}

        {/* Pan mode indicator */}
        {toolbarZoom > 1 && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/80 backdrop-blur-sm border border-slate-700/50 z-10">
            <Move className="w-3 h-3 text-amber-400" />
            <span className="text-[11px] text-slate-300">
              Drag to pan · Scroll to zoom
            </span>
          </div>
        )}
      </div>

      {/* Fullscreen Lightbox */}
      <AnimatePresence>
        {lightboxOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/95 backdrop-blur-md"
            onClick={(e) => {
              if (e.target === e.currentTarget && lbZoom <= 1) closeLightbox();
            }}
          >
            {/* Close button */}
            <button
              onClick={closeLightbox}
              className="absolute top-4 right-4 z-[110] p-2.5 rounded-xl bg-slate-800/80 backdrop-blur border border-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Lightbox zoom controls */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-800/90 backdrop-blur-md border border-slate-700/50 shadow-2xl z-[110]">
              <button
                onClick={lbZoomOut}
                disabled={lbZoom <= 0.5}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Zoom out (−)"
              >
                <ZoomOut className="w-5 h-5" />
              </button>

              <span className="text-sm font-mono text-slate-300 min-w-[4rem] text-center select-none">
                {Math.round(lbZoom * 100)}%
              </span>

              <button
                onClick={lbZoomIn}
                disabled={lbZoom >= 8}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Zoom in (+)"
              >
                <ZoomIn className="w-5 h-5" />
              </button>

              <button
                onClick={lbReset}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
                title="Reset (0)"
              >
                <RotateCcw className="w-5 h-5" />
              </button>

              <div className="w-px h-6 bg-slate-700 mx-1" />

              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
                title="Open original"
              >
                <ExternalLink className="w-5 h-5" />
              </a>
            </div>

            {/* Keyboard hints */}
            <div className="absolute top-4 left-4 z-[110] flex items-center gap-3 text-[11px] text-slate-500">
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400">
                  Esc
                </kbd>{" "}
                Close
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400">
                  +
                </kbd>
                <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 ml-0.5">
                  −
                </kbd>{" "}
                Zoom
              </span>
              <span>Scroll to zoom</span>
            </div>

            {/* Pan indicator for lightbox */}
            {lbZoom > 1 && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 backdrop-blur-sm border border-slate-700/50 z-[110]">
                <Move className="w-3 h-3 text-amber-400" />
                <span className="text-[11px] text-slate-300">
                  Drag to pan
                </span>
              </div>
            )}

            {/* Lightbox image */}
            <div
              className="w-full h-full flex items-center justify-center p-12 overflow-hidden"
              onWheel={handleLbWheel}
              onMouseDown={handleLbPanStart}
              onMouseMove={handleLbPanMove}
              onMouseUp={handleLbPanEnd}
              onMouseLeave={handleLbPanEnd}
              style={{
                cursor:
                  lbZoom > 1
                    ? lbPanning
                      ? "grabbing"
                      : "grab"
                    : "default",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={alt}
                className="max-w-full max-h-full object-contain select-none transition-transform duration-200 ease-out"
                style={{
                  transform: `scale(${lbZoom}) translate(${lbPan.x / lbZoom}px, ${lbPan.y / lbZoom}px)`,
                }}
                draggable={false}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
