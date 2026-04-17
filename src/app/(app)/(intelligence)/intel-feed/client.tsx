"use client";

import { useState } from "react";
import { AddPostModal } from "@/components/intelligence/AddPostModal";
import type { Competitor } from "@/lib/types/intelligence";

interface IntelFeedClientProps {
  competitors: Competitor[];
  tenantSlug: string;
}

export function IntelFeedClient({ competitors, tenantSlug }: IntelFeedClientProps) {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary-500 hover:bg-primary-600 transition-colors"
      >
        + Add Competitor Post
      </button>
      <AddPostModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        competitors={competitors}
        tenantSlug={tenantSlug}
      />
    </>
  );
}
