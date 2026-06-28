"use client";

import { useState } from "react";
import { Search, Loader2, Sparkles } from "lucide-react";

export function KeywordSeedInput() {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  async function handleSearch() {
    if (!query.trim()) return;
    setIsSearching(true);
    await new Promise((r) => setTimeout(r, 1500));
    setIsSearching(false);
  }

  return (
    <div className="bg-card rounded-xl p-5 border border-border/50 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={16} className="text-primary-500" />
        <h3 className="text-sm font-semibold text-foreground">AI Keyword Discovery</h3>
        <span className="text-text-muted text-xs ml-2">Enter a seed keyword to discover opportunities</span>
      </div>
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="e.g., content marketing, remote work tools..."
            className="w-full bg-background border border-border/50 rounded-lg pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={!query.trim() || isSearching}
          className="px-5 py-2.5 bg-primary-500 text-white text-sm font-medium rounded-lg hover:bg-primary-600 transition-colors active:scale-[0.98] disabled:opacity-50 flex items-center gap-2"
        >
          {isSearching ? <><Loader2 size={14} className="animate-spin" />Discovering...</> : "Discover Keywords"}
        </button>
      </div>
    </div>
  );
}
