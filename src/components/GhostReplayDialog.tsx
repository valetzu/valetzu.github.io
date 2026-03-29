import { useState } from "react";
import { formatTime } from "@/game/types";
import { deleteReplay, type ReplayData } from "@/game/replay";

interface GhostReplayDialogProps {
  levelId: string;
  replays: ReplayData[];
  onRace: (replay: ReplayData) => void;
  onClose: () => void;
}

type SortKey = "time" | "date";

const fmtDate = (ts: number) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function GhostReplayDialog({
  levelId,
  replays: initialReplays,
  onRace,
  onClose,
}: GhostReplayDialogProps) {
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [version, setVersion] = useState(0);
  const [replays, setReplays] = useState(initialReplays);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const handleDelete = (name: string) => {
    if (!window.confirm(`Delete replay "${name}"?`)) return;
    deleteReplay(levelId, name);
    setReplays((prev) => prev.filter((r) => r.name !== name));
    setVersion((v) => v + 1);
  };

  const dir = sortDir === "asc" ? 1 : -1;
  const sorted = [...replays].sort((a, b) =>
    sortKey === "time" ? (a.time - b.time) * dir : (a.date - b.date) * dir
  );
  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const thBtn = (key: SortKey, label: string, cls: string) => (
    <button
      onClick={() => handleSort(key)}
      className={`shrink-0 ${cls} text-right hover:text-game-title transition-colors${sortKey === key ? " text-game-accent font-bold" : ""}`}
    >
      {label}{arrow(key)}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-game-card border-2 border-game-card-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-game-card-border shrink-0">
          <h2 className="text-xl font-black text-game-title">👻 Ghost Replays</h2>
          <button
            onClick={onClose}
            className="text-game-subtitle hover:text-game-title transition-colors text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Column headers */}
        <div className="flex items-center gap-3 px-4 py-2 text-xs text-game-subtitle font-bold border-b border-game-card-border shrink-0 bg-game-bg">
          <span className="flex-1 min-w-0">Name</span>
          {thBtn("time", "Time", "w-16")}
          <span className="shrink-0 w-20 text-right">By</span>
          <span className="shrink-0 w-6 text-right">⭐</span>
          {thBtn("date", "Saved", "w-24")}
          <span className="shrink-0 w-[100px]" />
        </div>

        {/* Rows */}
        <div className="overflow-y-auto overscroll-contain flex-1 px-4 py-1">
          {sorted.length === 0 ? (
            <p className="text-game-subtitle text-sm text-center py-6">No replays saved.</p>
          ) : (
            sorted.map((r, i) => (
              <div
                key={`${version}-${i}`}
                className="flex items-center gap-3 py-2 text-sm text-game-subtitle border-b border-game-card-border/40 last:border-0"
              >
                <span className="flex-1 min-w-0 truncate text-game-title">{r.name}</span>
                <span className="shrink-0 w-16 text-right tabular-nums">{formatTime(r.time)}</span>
                <span className="shrink-0 w-20 text-right truncate text-xs">{r.nickname || "—"}</span>
                <span className="shrink-0 w-6 text-right text-xs">{r.starsCollected > 0 ? r.starsCollected : "—"}</span>
                <span className="shrink-0 w-24 text-right text-xs">{fmtDate(r.date)}</span>
                <div className="shrink-0 w-[100px] flex gap-1 justify-end">
                  <button
                    onClick={() => onRace(r)}
                    className="text-xs px-2 py-1 rounded-md bg-blue-700 text-white hover:bg-blue-500 active:scale-95 transition-all"
                  >
                    👻 Race
                  </button>
                  <button
                    onClick={() => handleDelete(r.name)}
                    className="text-xs px-1.5 py-1 rounded-md bg-red-900 text-white hover:bg-red-600 active:scale-95 transition-all"
                    title="Delete replay"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-game-card-border shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2 rounded-xl bg-game-bar-bg border-2 border-game-card-border text-game-title font-bold hover:brightness-110 active:scale-[0.98] transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
