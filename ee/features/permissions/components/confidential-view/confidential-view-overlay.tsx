import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const BAND_SIZE = 180;
const EDGE_PADDING = 16;

type ConfidentialViewOverlayProps = {
  navbarAbove?: boolean;
  rotation?: number;
};

function normalizedRotation(rotation: number) {
  return ((rotation % 360) + 360) % 360;
}

export function ConfidentialViewOverlay({
  navbarAbove = false,
  rotation = 0,
}: ConfidentialViewOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const quarterTurn = [90, 270].includes(normalizedRotation(rotation));

  const updatePosition = useCallback(
    (clientX: number, clientY: number) => {
      const root = rootRef.current;
      if (!root) return;

      const rect = root.getBoundingClientRect();
      const axisSize = quarterTurn ? rect.width : rect.height;

      if (axisSize <= 0) return;

      const rawPosition = quarterTurn
        ? clientX - rect.left
        : clientY - rect.top;

      const navbarInset = navbarAbove && !quarterTurn ? 64 : 0;
      const halfBand = Math.min(BAND_SIZE / 2, axisSize / 2);
      const min = Math.min(axisSize / 2, navbarInset + halfBand + EDGE_PADDING);
      const max = Math.max(min, axisSize - halfBand - EDGE_PADDING);

      setPosition(Math.min(max, Math.max(min, rawPosition)));
    },
    [navbarAbove, quarterTurn],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const resetPosition = () => {
      const rect = root.getBoundingClientRect();
      const axisSize = quarterTurn ? rect.width : rect.height;

      if (axisSize > 0) {
        setPosition(axisSize / 2);
      }
    };

    resetPosition();

    const observer = new ResizeObserver(resetPosition);
    observer.observe(root);

    return () => observer.disconnect();
  }, [quarterTurn]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && !dragging) {
        updatePosition(event.clientX, event.clientY);
      }
    };

    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });

    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [dragging, updatePosition]);

  const handleDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    updatePosition(event.clientX, event.clientY);
  };

  const center = position ?? 0;
  const halfBand = BAND_SIZE / 2;

  const firstSize = Math.max(0, center - halfBand);
  const secondStart = center + halfBand;

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-0 z-40 overflow-hidden"
    >
      {quarterTurn ? (
        <>
          <div
            className="absolute bottom-0 left-0 top-0 bg-background/20 backdrop-blur-xl"
            style={{ width: firstSize }}
          />
          <div
            className="absolute bottom-0 right-0 top-0 bg-background/20 backdrop-blur-xl"
            style={{ left: secondStart }}
          />
        </>
      ) : (
        <>
          <div
            className="absolute left-0 right-0 top-0 bg-background/20 backdrop-blur-xl"
            style={{ height: firstSize }}
          />
          <div
            className="absolute bottom-0 left-0 right-0 bg-background/20 backdrop-blur-xl"
            style={{ top: secondStart }}
          />
        </>
      )}

      <button
        type="button"
        aria-label="Move confidential viewing area"
        className={
          quarterTurn
            ? "pointer-events-auto absolute top-3 h-8 w-16 -translate-x-1/2 cursor-ew-resize touch-none rounded-full border bg-background/90 shadow-sm backdrop-blur"
            : "pointer-events-auto absolute right-3 h-16 w-8 -translate-y-1/2 cursor-ns-resize touch-none rounded-full border bg-background/90 shadow-sm backdrop-blur"
        }
        style={
          quarterTurn
            ? { left: center }
            : {
                top: center,
              }
        }
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          updatePosition(event.clientX, event.clientY);
        }}
        onPointerMove={handleDrag}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          setDragging(false);
        }}
        onPointerCancel={() => setDragging(false)}
      >
        <span
          className={
            quarterTurn
              ? "mx-auto block h-1 w-8 rounded-full bg-muted-foreground/60"
              : "mx-auto block h-8 w-1 rounded-full bg-muted-foreground/60"
          }
        />
      </button>
    </div>
  );
}

export default ConfidentialViewOverlay;
