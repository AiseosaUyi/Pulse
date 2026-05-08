import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ConnectDrivePrompt({
  missingSections = false,
}: {
  missingSections?: boolean;
}) {
  return (
    <div className="bg-card border border-dashed border-border rounded-2xl p-10 text-center">
      <div className="w-12 h-12 rounded-2xl bg-primary-50 flex items-center justify-center mx-auto mb-4">
        <FolderOpen size={20} className="text-primary-600" />
      </div>
      <h2 className="text-foreground font-semibold mb-1.5">
        {missingSections
          ? "Drive sections missing"
          : "Connect Google Drive to start"}
      </h2>
      <p className="text-text-muted text-sm max-w-[420px] mx-auto mb-5">
        {missingSections
          ? "Drive is connected but the /Pulse folders weren't created. Disconnect and reconnect to retry."
          : "Pulse stores team media in your team's Drive — files stay where you already keep them. Pulse tracks the metadata, status, and ownership."}
      </p>
      <Link href="/settings/integrations">
        <Button>
          {missingSections ? "Manage connection" : "Connect Drive"}
        </Button>
      </Link>
    </div>
  );
}
